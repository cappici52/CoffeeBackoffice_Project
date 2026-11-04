"""Frozen rolling evaluation of existing v5 candidates; never deploys a model.

Writes predictions before selecting held-out outcomes. Existing prediction files
are reused only with the exact same protocol/source/engine, never overwritten.
"""
import argparse
from collections import Counter, defaultdict
from datetime import date, timedelta, datetime, timezone
import hashlib
import json
from pathlib import Path

import engine

MODELS=(*engine.METHODS,'direct','auto')
LABELS={'weekly-naive-v1':'Matching-weekday Naive','last-value-v1':'Last Value Naive','mean-7-v1':'Moving Average 7',
        'mean-28-v1':'Moving Average 28','weekday-mean-v1':'Weekday Average','ses-v1':'SES','direct':'XGBoost','auto':'Automatic v5'}


def schedule(end,days,horizon):
    count=days//horizon
    start=end-timedelta(days=count*horizon-1)
    return [(start+timedelta(days=i*horizon)).isoformat() for i in range(count)]


def predictions(data,outlet,cutoff,horizon):
    start=date.fromisoformat(cutoff)
    history=[dict(date=r['date'],product_id=r['product_id'],qty=float(r['qty']),unit_price=0.,source='actual')
             for r in data['daily'] if r['outlet_id']==outlet and (start-timedelta(days=180)).isoformat()<=r['date']<cutoff]
    history.sort(key=lambda r:(r['date'],r['product_id']))
    ids=sorted({r['product_id'] for r in history})
    end=(start+timedelta(days=horizon-1)).isoformat()
    auto=engine.predict(cutoff,end,ids,history,cohort='public_dataset')
    origin=date.fromisoformat(auto[0]['diagnostics']['origin'])
    used=[r for r in history if (origin-timedelta(days=179)).isoformat()<=r['date']<=origin.isoformat()]
    series={p:engine.Series() for p in ids}
    for r in used:series[r['product_id']][date.fromisoformat(r['date'])]=r
    targets=[start+timedelta(days=i) for i in range(horizon)]
    model=engine.fit(series,ids,origin)
    output={'auto':auto}
    for method in (*engine.METHODS,'direct'):
        if method=='direct' and model is None:continue
        values=engine.estimates(series,ids,origin,targets,method,model)
        output[method]=[dict(date=d.isoformat(),product_id=p,predicted_qty=round(v,3)) for p in ids for d,v in zip(targets,values[p])]
    return dict(cutoff=cutoff,horizon=horizon,origin=origin.isoformat(),training_from=used[0]['date'],training_to=used[-1]['date'],
                history_sha256=hashlib.sha256(json.dumps(used,sort_keys=True).encode()).hexdigest(),predictions=output)


def scores(rows):
    matched=[r for r in rows if r['actual'] is not None]
    product=engine.metrics([(r['actual'],r['predicted']) for r in matched])
    groups=defaultdict(list)
    for row in rows:groups[(row['cutoff'],row['date'])].append(row)
    complete=[group for group in groups.values() if all(r['actual'] is not None for r in group)]
    total=engine.metrics([(sum(r['actual'] for r in group),sum(r['predicted'] for r in group)) for group in complete])
    return dict(product_day=product,daily_total=total,missing_pairs=len(rows)-len(matched))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepared',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=Path('.local/public-datasets/ihelon-coffee-sales/evaluation'))
    parser.add_argument('--outlet',default='index_1')
    parser.add_argument('--evaluation-days',type=int,default=90)
    args=parser.parse_args()
    if args.evaluation_days<30:raise ValueError('At least 30 evaluation days required')
    raw=args.prepared.read_bytes();data=json.loads(raw)
    end=date.fromisoformat(next(o['date_to'] for o in data['outlets'] if o['id']==args.outlet))
    protocol=dict(format='coffee-v5-rolling-research-v1',dataset_id=data['id'],prepared_sha256=hashlib.sha256(raw).hexdigest(),
                  engine_sha256=hashlib.sha256(Path(engine.__file__).read_bytes()).hexdigest(),pipeline=engine.PIPELINE_VERSION,
                  outlet=args.outlet,history_calendar_days=180,evaluation_calendar_days=args.evaluation_days,
                  cutoffs={str(h):schedule(end,args.evaluation_days,h) for h in (1,7,30)},
                  selection='Existing v5 prior-only rolling selection/calibration, unchanged promotion guards.',
                  candidates=list(MODELS),policy='No tuning on outer target outcomes. Each candidate evaluated on identical available pairs within a horizon; unknown targets excluded, not zero-filled.',
                  previous_exposure='Source was inspected and evaluated with a legacy 28-day pipeline previously; this is a new fixed-protocol re-evaluation, not a pristine independent dataset.')
    args.output.mkdir(parents=True,exist_ok=True)
    frozen=args.output/'prepared-frozen.json'
    if frozen.exists():
        if frozen.read_bytes()!=raw:raise ValueError('Use the original frozen input for this experiment')
    else:frozen.write_bytes(raw)
    protocol_path=args.output/'protocol.json'
    if protocol_path.exists():
        if json.loads(protocol_path.read_text())!=protocol:raise ValueError('Protocol differs from existing experiment; choose a new output directory')
    else:protocol_path.write_text(json.dumps(protocol,indent=2),encoding='utf-8')
    all_rows={};files=[]
    for horizon in (1,7,30):
        by_model=defaultdict(list)
        for index,cutoff in enumerate(protocol['cutoffs'][str(horizon)]):
            path=args.output/f'predictions-{horizon}-{cutoff}.json'
            if path.exists():
                record=json.loads(path.read_text())
                if record['protocol_sha256']!=hashlib.sha256(protocol_path.read_bytes()).hexdigest():raise ValueError('Frozen prediction protocol mismatch')
            else:
                record=predictions(data,args.outlet,cutoff,horizon)
                record.update(executed_at=datetime.now(timezone.utc).isoformat(),protocol_sha256=hashlib.sha256(protocol_path.read_bytes()).hexdigest())
                with path.open('x',encoding='utf-8') as out:json.dump(record,out)
            # Outcomes become scoring inputs only after predictions are on disk.
            truth={(r['date'],r['product_id']):r['qty'] for r in data['daily'] if r['outlet_id']==args.outlet and cutoff<=r['date']<=(date.fromisoformat(cutoff)+timedelta(days=horizon-1)).isoformat()}
            for method,points in record['predictions'].items():
                by_model[method]+=[dict(cutoff=cutoff,date=p['date'],product_id=p['product_id'],predicted=p['predicted_qty'],actual=truth.get((p['date'],p['product_id']))) for p in points]
            files.append(dict(file=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
            print(f'horizon={horizon} fold={index+1}/{len(protocol["cutoffs"][str(horizon)])} cutoff={cutoff}',flush=True)
        all_rows[str(horizon)]=dict(by_model)
    report=dict(protocol=protocol,frozen_prediction_files=files,models={},by_product={})
    for horizon,by_model in all_rows.items():
        report['models'][horizon]={method:scores(rows) for method,rows in by_model.items()}
        report['by_product'][horizon]=[dict(product_id=p['id'],name=p['name'],**scores([r for r in by_model['auto'] if r['product_id']==p['id']])['product_day']) for p in data['products']]
    (args.output/'results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    md=['# Coffee Sales v5 rolling evaluation','',f"Dataset {data['name']} V{data['version']} · outlet {args.outlet}. Fixed trailing {args.evaluation_days} calendar-day protocol; no operational model deployment.",'']
    for h,models in report['models'].items():
        md += [f'## {h}-day horizon','', '| Model | Product samples | MAE | RMSE | WAPE % | Bias | Total-day samples | Total MAE | Total RMSE | Total WAPE % | Total Bias |','|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
        for method in MODELS:
            if method not in models:continue
            p,t=models[method]['product_day'],models[method]['daily_total']
            fmt=lambda v:'—' if v is None else f'{v:.4f}'
            md.append('| '+LABELS[method]+' | '+str(p['samples'])+' | '+' | '.join(fmt(p[k]) for k in ('mae','rmse','wape','bias'))+' | '+str(t['samples'])+' | '+' | '.join(fmt(t[k]) for k in ('mae','rmse','wape','bias'))+' |')
        md+=['','| Product (automatic selection) | Samples | MAE | RMSE | WAPE % | Bias |','|---|---:|---:|---:|---:|---:|']
        for p in report['by_product'][h]:md.append('| '+p['name']+' | '+str(p['samples'])+' | '+' | '.join(fmt(p[k]) for k in ('mae','rmse','wape','bias'))+' |')
        md+=['']
    md+=['Scores across datasets or horizon populations are not proof of model improvement. Aggregate errors can cancel product errors. Missing dates remain unknown. This vending-machine source does not validate a new CoffeeBackoffice shop.','']
    (args.output/'comparison.md').write_text('\n'.join(md),encoding='utf-8')


if __name__=='__main__':main()
