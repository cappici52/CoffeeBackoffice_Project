"""Verified Mendeley v2 ETL. Raw files stay unchanged; never accesses the POS DB."""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import date, time, timedelta
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
from pathlib import Path
from urllib.request import Request, urlopen
from uuid import uuid5, NAMESPACE_URL

SOURCE = 'https://data.mendeley.com/datasets/kcgf45y24m/2'
DOI = '10.17632/kcgf45y24m.2'
TRANSFORM = 'mendeley-item-occurrences-v1'
HASHES = {'Products.csv': '09e3d91530797fb0c2c5a214f5660a6e2235521b1cf332382343c75e7708d047',
          'Transactions.csv': '36f2412969f8241e72b5f3eb395e5af13a7ba042de1e6ecdbe32bee23723ef90'}
TRANSACTIONS = {'Outlet','Date','Time','NetSales','Tax','TotalAmount','ReceiptNumber','Items','TotalItem','PaymentMethod','UseLoyaltyCard'}
PRODUCTS = {'ProductId','ProductName','Variant','Category','Price','Description'}


def csv_rows(raw, columns):
    reader = csv.DictReader(io.StringIO(raw.decode('utf-8-sig'), newline=''))
    if len(reader.fieldnames or []) != len(columns) or set(reader.fieldnames or []) != columns:
        raise ValueError('Unexpected CSV columns')
    rows = list(reader)
    if not rows or any(set(r) != columns or any(v is None or not v.strip() for v in r.values()) for r in rows):
        raise ValueError('Empty CSV, missing values or malformed rows')
    return rows


def money(value):
    try:
        n = Decimal(value)
        if not n.is_finite() or n < 0:
            raise ValueError('Negative or nonfinite monetary value')
        return n
    except InvalidOperation as e:
        raise ValueError('Invalid monetary value') from e


def normalize(transactions_raw, products_raw):
    products = csv_rows(products_raw, PRODUCTS)
    transactions = csv_rows(transactions_raw, TRANSACTIONS)
    catalog, external_ids = {}, set()
    for p in products:
        name = p['ProductName'] + (' ('+p['Variant']+')' if p['Variant'] != '-' else '')
        if name in catalog or p['ProductId'] in external_ids:
            raise ValueError('Ambiguous product identity')
        money(p['Price'])  # Metadata is validated, but NEVER used as a historical feature price.
        catalog[name] = dict(id=str(uuid5(NAMESPACE_URL, DOI+'/product/'+p['ProductId'])),
                             external_id=p['ProductId'], name=name, category=p['Category'])
        external_ids.add(p['ProductId'])
    seen, days, first, counts = {}, defaultdict(set), {}, Counter()
    duplicates = 0
    for row in transactions:
        d = date.fromisoformat(row['Date'])
        if d.isoformat() != row['Date']:
            raise ValueError('Noncanonical date')
        time.fromisoformat(row['Time'])
        for key in ['NetSales','Tax','TotalAmount']:
            money(row[key])
        key = (row['Outlet'], row['ReceiptNumber'])
        fingerprint = tuple(sorted(row.items()))
        if key in seen:
            if seen[key] != fingerprint:
                raise ValueError('Conflicting duplicate receipt')
            duplicates += 1
            continue
        seen[key] = fingerprint
        tokens = row['Items'].split(', ')
        if not row['TotalItem'].isdigit() or int(row['TotalItem']) <= 0 or len(tokens) != int(row['TotalItem']):
            raise ValueError('Item list cannot be reconciled with TotalItem; quantities are ambiguous')
        if any(t not in catalog for t in tokens):
            raise ValueError('Unmapped product token')
        outlet = row['Outlet']
        days[outlet].add(d)
        for token in tokens:
            pid = catalog[token]['id']
            first[(outlet,pid)] = min(first.get((outlet,pid),d),d)
            counts[(outlet,d,pid)] += 1
    daily = []
    for (outlet,pid), since in sorted(first.items()):
        for d in sorted(days[outlet]):
            if d >= since:
                qty = counts[(outlet,d,pid)]
                daily.append(dict(outlet_id=outlet,date=d.isoformat(),product_id=pid,qty=qty,
                                  quality='observed' if qty else 'inferred_zero'))
    daily.sort(key=lambda r:(r['outlet_id'],r['date'],r['product_id']))
    coverage = []
    for outlet, active in sorted(days.items()):
        start, end = min(active), max(active)
        missing = [(start+timedelta(days=i)).isoformat() for i in range((end-start).days+1) if start+timedelta(days=i) not in active]
        coverage.append(dict(id=outlet,date_from=start.isoformat(),date_to=end.isoformat(),active_days=len(active),missing_dates=missing))
    hashes = {'Transactions.csv':hashlib.sha256(transactions_raw).hexdigest(),'Products.csv':hashlib.sha256(products_raw).hexdigest()}
    identity = hashlib.sha256(json.dumps(dict(hashes=hashes,transform=TRANSFORM),sort_keys=True).encode()).hexdigest()
    return dict(format='coffee-public-dataset-v1',id=str(uuid5(NAMESPACE_URL,DOI+'/'+identity)),data_mode='PUBLIC_DATASET',
                name='Anonymous Transactional Dataset',version='2',source_url=SOURCE,doi=DOI,license='CC BY 4.0',
                license_url='https://creativecommons.org/licenses/by/4.0/',
                attribution='Engel, Mychael Maoeretz; Gaol, Ford Lumban; Kurniawan, Aditya; Budiharto, Widodo (2026), Anonymous Transactional Dataset, Mendeley Data, V2, doi:10.17632/kcgf45y24m.2',
                transform_version=TRANSFORM,content_sha256=identity,raw_hashes=hashes,
                products=sorted(catalog.values(),key=lambda p:p['name']),outlets=coverage,daily=daily,
                report=dict(raw_transactions=len(transactions),unique_receipts=len(seen),exact_duplicates_skipped=duplicates,
                            item_occurrences=sum(counts.values()),daily_rows=len(daily),inferred_zero_rows=sum(r['quality']=='inferred_zero' for r in daily),
                            date_from=min(r['date'] for r in daily),date_to=max(r['date'] for r in daily),
                            target='Recorded item occurrences per product, outlet and source-calendar date; TotalItem reconciles list length.',
                            zero_policy='After first observed product occurrence, no item on an outlet-active date is an inferred recorded-sales zero. Dates without any outlet receipts remain unknown. This does not prove stock or menu availability.',
                            price_policy='Currency is not specified by the files. Static product metadata prices and basket totals are excluded from all model features; unit_price=0.',
                            limitations=['No item-level quantity field beyond item tokens and TotalItem; this target is reconciled recorded item occurrences.',
                                         'No stockout, closure, cancellation or complete-day flags; recorded sales are not unconstrained demand.',
                                         'Dates use the source calendar without assuming a timezone or converting them to Bangkok.']))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,default=Path('.local/public-datasets/mendeley-kcgf45y24m-v2'))
    parser.add_argument('--download',action='store_true')
    args=parser.parse_args()
    raw_dir=args.directory/'raw'
    raw_dir.mkdir(parents=True,exist_ok=True)
    if args.download:
        url='https://data.mendeley.com/public-api/datasets/kcgf45y24m/files?folder_id=root&version=2&$start=0&$limit=1000'
        files=json.load(urlopen(Request(url,headers={'Accept':'application/vnd.mendeley-public-dataset.1+json','User-Agent':'CoffeeBackoffice research ETL'}),timeout=30))
        for f in files:
            name=f['filename']
            if name not in HASHES:
                continue
            path=raw_dir/name
            if not path.exists():
                data=urlopen(Request(f['content_details']['download_url'],headers={'User-Agent':'CoffeeBackoffice research ETL'}),timeout=60).read(10_000_001)
                if hashlib.sha256(data).hexdigest()!=HASHES[name]:
                    raise ValueError('Publisher file hash changed; inspect before adoption')
                path.write_bytes(data)
    raw={name:(raw_dir/name).read_bytes() for name in HASHES}
    if any(hashlib.sha256(b).hexdigest()!=HASHES[name] for name,b in raw.items()):
        raise ValueError('Raw checksum mismatch; never edit original source files')
    result=normalize(raw['Transactions.csv'],raw['Products.csv'])
    (args.directory/'prepared.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
    (args.directory/'provenance.json').write_text(json.dumps({k:v for k,v in result.items() if k!='daily'},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(id=result['id'],outlets=result['outlets'],report=result['report']),ensure_ascii=True))


if __name__=='__main__':
    main()
