"""Read-only density audit of fictional/synthetic Maven Roasters transactions.

This does not adapt/import data into the application or fit forecasting models.
"""
import argparse
from collections import Counter, defaultdict
from datetime import date, timedelta
import csv
import io
import json
from pathlib import Path
import statistics
import zipfile

from investigate_sparse import digest

SOURCE='https://www.kaggle.com/datasets/agungpambudi/trends-product-coffee-shop-sales-revenue-dataset'
PUBLISHER='https://mavenanalytics.io/data-playground/coffee-shop-sales'
MEMBER='coffee-shop-sales-revenue.csv'
FIELDS={'transaction_id','transaction_date','transaction_time','transaction_qty','store_id','store_location',
        'product_id','unit_price','product_category','product_type','product_detail'}


def describe(values):
    values=list(values);mean=statistics.mean(values)
    return dict(periods=len(values),total=sum(values),mean=mean,minimum=min(values),maximum=max(values),
                std=statistics.pstdev(values),zero_percent=100*sum(v==0 for v in values)/len(values),
                cv=statistics.pstdev(values)/mean if mean else None)


def inspect(path):
    events=Counter();units=Counter();product_units=Counter();products={};stores={};ids=Counter();exact=set();nulls=Counter()
    count=duplicates=0
    with zipfile.ZipFile(path) as archive:
        with io.TextIOWrapper(archive.open(MEMBER),encoding='utf-8-sig') as stream:
            reader=csv.DictReader(stream,delimiter='|')
            if set(reader.fieldnames)!=FIELDS:raise ValueError('Unexpected Maven schema')
            for row in reader:
                count+=1;key=tuple(row.items());duplicates+=key in exact;exact.add(key)
                nulls.update(k for k,v in row.items() if v is None or not v.strip())
                d=date.fromisoformat(row['transaction_date']);qty=int(row['transaction_qty'])
                if qty<=0:raise ValueError('Nonpositive quantity requires explicit returns policy')
                store=row['store_id'];product=row['product_id'];ids[row['transaction_id']]+=1
                events[(store,d)]+=1;units[(store,d)]+=qty;product_units[(store,product,d)]+=qty
                detail={k:row[k] for k in ('product_detail','product_type','product_category')}
                if product in products and products[product]!=detail:raise ValueError('Inconsistent product definition')
                products[product]=detail;stores[store]=row['store_location']
    if not count:raise ValueError('Empty source')
    dates={d for _,d in events};start,end=min(dates),max(dates)
    calendar=[start+timedelta(days=i) for i in range((end-start).days+1)]
    outlets=[];product_stats=[];pairs=[]
    for store,name in sorted(stores.items()):
        active=sorted(d for s,d in events if s==store)
        missing=[d.isoformat() for d in calendar if (store,d) not in events]
        outlets.append(dict(store_id=store,name=name,active_dates=len(active),missing_dates=missing,
                            recorded_rows=describe(events[(store,d)] for d in active),units=describe(units[(store,d)] for d in active)))
        for product,detail in sorted(products.items()):
            seen=sorted(d for s,p,d in product_units if s==store and p==product)
            if not seen:continue
            observed=[d for d in active if d>=seen[0]]
            pairs.extend((store,product,d) for d in observed)
            product_stats.append(dict(store_id=store,product_id=product,**detail,
                                      first_appearance=seen[0].isoformat(),active_sales_days=len(seen),
                                      inferred_recorded_sales=describe(product_units[(store,product,d)] for d in observed)))
    def pooled(coffee_only):
        selected=[(s,p,d) for s,p,d in pairs if not coffee_only or products[p]['product_category']=='Coffee']
        return describe(product_units[key] for key in selected)
    return dict(label='Fictional/synthetic Maven Roasters; not observed operational shop sales',source=SOURCE,publisher=PUBLISHER,
                archive_sha256=digest(path),member=MEMBER,rows=count,exact_duplicate_rows=duplicates,
                repeated_transaction_ids=sum(v-1 for v in ids.values()),missing_fields=dict(nulls),
                date_from=start.isoformat(),date_to=end.isoformat(),calendar_days=len(calendar),
                product_count=len(products),coffee_product_count=sum(p['product_category']=='Coffee' for p in products.values()),
                total_quantity=sum(units.values()),quantity_semantics='Sum transaction_qty; one row need not equal one unit or a multi-line basket.',
                stores=outlets,product_store_statistics=product_stats,
                pooled_product_store_days=pooled(False),pooled_coffee_product_store_days=pooled(True),
                quality='No availability/stockout/complete-day flags. Product zeroes inferred on active store days after first appearance. Missing store dates remain unknown.',
                suitability='Separate controlled denser-data experiment only; do not import into operational sales/inventory, or compare WAPE across sources as model improvement.')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',type=Path,default=Path('.local/public-datasets/maven-roasters-density-v1/original.zip'))
    parser.add_argument('--output',type=Path,default=Path('.local/public-datasets/maven-roasters-density-v1/inspection.json'))
    args=parser.parse_args();result=inspect(args.archive);result['code_sha256']=digest(Path(__file__))
    raw=json.dumps(result,indent=2)
    if args.output.exists() and args.output.read_text(encoding='utf8')!=raw:raise ValueError('Inspection differs; use a new output file')
    args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(raw,encoding='utf8')
    print(f'Inspected fictional Maven source: {result["rows"]} rows, {result["product_count"]} products, {result["calendar_days"]} calendar days.')


if __name__=='__main__':main()
