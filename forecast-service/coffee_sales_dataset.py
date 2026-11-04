"""Adapt the inspected ihelon Coffee Sales source to existing research storage.

Reuses the original verified-source parser; leaves old benchmarks untouched.
Run with the project's Python environment (NumPy/XGBoost are already required).
"""
import argparse
from collections import Counter
import csv
from datetime import date, datetime
import hashlib
import io
import json
from pathlib import Path
import statistics
from urllib.request import Request, urlopen
from uuid import uuid5, NAMESPACE_URL
import zipfile

from train_external import prepare, DATASET, SOURCE_URL, DOWNLOAD_URL

TRANSFORM = 'ihelon-vend-events-v1'
ARCHIVE_SHA = 'e7942082609296f308f459f03f5e3f7da7ee3c5e3be18145eb171c28abf11a56'
METADATA_URL = 'https://www.kaggle.com/api/v1/datasets/view/'+DATASET


def distribution(values):
    values=list(values)
    average=statistics.mean(values)
    return dict(days=len(values),total=sum(values),minimum=min(values),maximum=max(values),mean=average,
                median=statistics.median(values),std=statistics.pstdev(values),
                zero_days=sum(v==0 for v in values),cv=statistics.pstdev(values)/average if average else None)


def inspect_archive(path):
    streams=[]
    with zipfile.ZipFile(path) as archive:
        for member in archive.infolist():
            if not member.filename.endswith('.csv'):
                continue
            if member.file_size>10_000_000:
                raise ValueError('Unexpected member size')
            raw=archive.read(member)
            reader=csv.DictReader(io.StringIO(raw.decode('utf-8-sig')))
            rows=list(reader)
            days=Counter(r['date'] for r in rows)
            streams.append(dict(member=member.filename,sha256=hashlib.sha256(raw).hexdigest(),columns=reader.fieldnames,
                                rows=len(rows),date_from=min(days),date_to=max(days),active_days=len(days),
                                exact_duplicates=len(rows)-len(set(tuple(r.items()) for r in rows)),
                                nulls=dict(Counter(k for r in rows for k,v in r.items() if v is None or not v.strip())),
                                products=dict(sorted(Counter(r['coffee_name'] for r in rows).items())),daily=distribution(days.values())))
    return streams


def normalize(path,metadata):
    if metadata.get('licenseName')!='CC0: Public Domain' or metadata.get('currentVersionNumber')!=21:
        raise ValueError('Review source version/license before adopting a changed dataset')
    series,provenance=prepare(path)
    # Additional timestamp validation; nullable anonymous card values are irrelevant.
    with zipfile.ZipFile(path) as archive:
        for row in csv.DictReader(io.StringIO(archive.read('index_1.csv').decode('utf-8-sig'))):
            timestamp=datetime.fromisoformat(row['datetime'])
            if timestamp.date().isoformat()!=row['date'] or not row['cash_type'].strip():
                raise ValueError('Invalid timestamp or payment marker')
    streams=inspect_archive(path)
    selected=next(s for s in streams if s['member']=='index_1.csv')
    identity=hashlib.sha256(json.dumps(dict(raw=provenance['archive_sha256'],transform=TRANSFORM,version=21),sort_keys=True).encode()).hexdigest()
    products=[dict(id=str(uuid5(NAMESPACE_URL,SOURCE_URL+'/product/'+name)),external_id=name,name=name) for name in series]
    ids={p['name']:p['id'] for p in products}
    daily=sorted([dict(outlet_id='index_1',date=d.isoformat(),product_id=ids[name],qty=int(qty),
                       quality='observed' if qty else 'inferred_zero') for name,values in series.items() for d,qty in values.items()],
                 key=lambda r:(r['date'],r['product_id']))
    product_patterns=[dict(product_id=ids[name],name=name,first_date=min(values).isoformat(),last_date=max(values).isoformat(),
                           **distribution(values.values())) for name,values in series.items()]
    return dict(format='coffee-public-dataset-v1',id=str(uuid5(NAMESPACE_URL,SOURCE_URL+'/'+identity)),data_mode='PUBLIC_DATASET',
                name='Coffee Sales — ihelon',version='21',source_url=SOURCE_URL,license='CC0: Public Domain',
                license_url='https://creativecommons.org/publicdomain/zero/1.0/',
                attribution='Yaroslav Isaienkov (ihelon), Coffee Sales, Kaggle, version 21. Publisher-described vending-machine records; not independently audited.',
                transform_version=TRANSFORM,content_sha256=identity,raw_hashes={'original.zip':provenance['archive_sha256'],'index_1.csv':provenance['source_csv_sha256']},
                products=products,outlets=[dict(id='index_1',label='index_1 (source stream; physical outlet unknown)',date_from=provenance['first_date'],date_to=provenance['last_date'],
                                                active_days=provenance['machine_active_days'],missing_dates=provenance['unknown_days'])],daily=daily,
                report=dict(raw_transactions=provenance['raw_rows'],item_occurrences=provenance['raw_rows'],
                            date_from=provenance['first_date'],date_to=provenance['last_date'],daily_rows=len(daily),
                            inferred_zero_rows=sum(r['quality']=='inferred_zero' for r in daily),
                            streams=streams,product_patterns=product_patterns,daily_distribution=selected['daily'],
                            publisher_updated=metadata.get('lastUpdated'),publisher_version=21,
                            target='Recorded beverage vend events per product and source-calendar date. One raw row is one recorded transaction; no quantity column.',
                            quantity_semantics='One row = one recorded vend event, not independently verified cups. No conversion from money to quantity.',
                            zero_policy='After first recorded product occurrence, no records on a machine-active date imply an inferred recorded-sales zero; seven fully missing dates remain unknown. No stock/open-day completeness evidence.',
                            price_policy='Money, unspecified currency, payment type and anonymous card fields are excluded from model features; unit_price=0.',
                            provenance_status='Publisher says records come from their vending machine. No independent audit and no source claim of synthetic generation.',
                            limitations=['Source is a vending machine, not a staffed multi-menu coffee shop; physical outlet identity/timezone and currency are not established.',
                                         'No quantity, receipt ID, cancellation, stockout, recipe or full-day availability fields.',
                                         'index_2.csv is a separate unidentified stream with only 41 active days and two exact duplicates; inspected but excluded, never merged.',
                                         'This exact source was evaluated previously with a legacy 28-day method; the new results are a chronological re-evaluation with v5, not an untouched new independent dataset.',
                                         'Reported transactions and inferred zeros are not proof of unconstrained demand.']))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,default=Path('.local/public-datasets/ihelon-coffee-sales'))
    parser.add_argument('--download',action='store_true')
    args=parser.parse_args();args.directory.mkdir(parents=True,exist_ok=True)
    archive=args.directory/'original.zip';metadata_path=args.directory/'metadata.json'
    if args.download:
        meta=json.load(urlopen(Request(METADATA_URL,headers={'User-Agent':'CoffeeBackoffice research'}),timeout=30))
        if meta.get('currentVersionNumber')!=21 or meta.get('licenseName')!='CC0: Public Domain':
            raise ValueError('Publisher version/license changed; review before download')
        metadata_path.write_text(json.dumps(meta,indent=2),encoding='utf-8')
        if not archive.exists():
            data=urlopen(DOWNLOAD_URL,timeout=60).read(20_000_001)
            if hashlib.sha256(data).hexdigest()!=ARCHIVE_SHA:raise ValueError('Archive hash changed')
            archive.write_bytes(data)
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=ARCHIVE_SHA:raise ValueError('Unexpected archive hash; raw data is immutable')
    result=normalize(archive,json.loads(metadata_path.read_text(encoding='utf-8')))
    (args.directory/'prepared.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
    (args.directory/'inspection.json').write_text(json.dumps({k:v for k,v in result.items() if k!='daily'},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(dict(id=result['id'],transactions=result['report']['raw_transactions'],products=[p['name'] for p in result['products']],rows=len(result['daily']))))


if __name__=='__main__':main()
