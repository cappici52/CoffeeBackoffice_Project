"""Root-cause audit and frozen sparse-demand experiment on unchanged v5 folds.

Read-only with respect to raw data, previous predictions, database and production.
"""
import argparse
from collections import Counter,defaultdict
from datetime import date,timedelta,datetime,timezone
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import statistics
import zipfile

import engine
from evaluate_research import scores
from sparse_candidates import INTERMITTENT,HIERARCHICAL,statistical_predictions,select_from_past,global_onehot

NEW_MODELS=(*INTERMITTENT,*HIERARCHICAL,'global-xgb-onehot','past-selected-stat')


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def demand_stats(rows):
    values=[r['qty'] for r in rows]
    positive=[v for v in values if v>0]
    mean=statistics.mean(values) if values else None
    return dict(observations=len(values),positive_periods=len(positive),zero_periods=sum(v==0 for v in values),
                zero_percent=100*sum(v==0 for v in values)/len(values) if values else None,total=sum(values),mean=mean,
                std=statistics.pstdev(values) if values else None,
                cv=statistics.pstdev(values)/mean if mean else None,
                fano=statistics.pvariance(values)/mean if mean else None,
                adi=len(values)/len(positive) if positive else None,
                positive_size_cv2=statistics.pvariance(positive)/statistics.mean(positive)**2 if positive else None)


def audit_data(data,archive,first_target):
    with zipfile.ZipFile(archive) as source:
        rows=list(csv.DictReader(io.StringIO(source.read('index_1.csv').decode('utf-8-sig'))))
    names={p['id']:p['name'] for p in data['products']}
    counter=Counter((r['date'],r['coffee_name']) for r in rows)
    daily=[r for r in data['daily'] if r['outlet_id']=='index_1']
    for r in daily:
        if r['qty']!=counter[(r['date'],names[r['product_id']])]:raise ValueError('Normalized outcomes differ from raw event counts')
    days=Counter(r['date'] for r in rows)
    start,end=date.fromisoformat(min(days)),date.fromisoformat(max(days))
    missing=[(start+timedelta(days=i)).isoformat() for i in range((end-start).days+1) if (start+timedelta(days=i)).isoformat() not in days]
    if any(r['date'] in missing for r in daily):raise ValueError('Missing dates were filled')
    products=[]
    for p in data['products']:
        observations=[r for r in daily if r['product_id']==p['id']]
        products.append(dict(id=p['id'],name=p['name'],full=demand_stats(observations),
                             before_evaluation=demand_stats([r for r in observations if r['date']<first_target]),
                             evaluation=demand_stats([r for r in observations if r['date']>=first_target])))
    return dict(raw_archive_sha256=digest(archive),raw_events=len(rows),duplicate_raw_rows=len(rows)-len(set(tuple(r.items()) for r in rows)),
                full_calendar_days=(end-start).days+1,active_dates=len(days),missing_dates=missing,
                verified_full_day_zero_sales_dates=0,
                zero_status='No source closure/availability evidence. Product zeroes are inferred recorded-sales zeroes on active dates, not verified zero demand.',
                source_daily_total=dict(mean=statistics.mean(days.values()),median=statistics.median(days.values()),minimum=min(days.values()),maximum=max(days.values()),std=statistics.pstdev(days.values())),
                inferred_zero_product_periods=sum(r['qty']==0 for r in daily),normalized_product_periods=len(daily),
                unknown_policy='Omit missing periods from intermittent state updates and score masks. Never impute zeros.',products=products)


def context(data,outlet,cutoff,old):
    start=date.fromisoformat(cutoff);origin=date.fromisoformat(old['origin'])
    history=[dict(date=r['date'],product_id=r['product_id'],qty=float(r['qty']),unit_price=0.,source='actual')
             for r in data['daily'] if r['outlet_id']==outlet and (start-timedelta(days=180)).isoformat()<=r['date']<cutoff]
    used=sorted([r for r in history if (origin-timedelta(days=179)).isoformat()<=r['date']<=origin.isoformat()],key=lambda r:(r['date'],r['product_id']))
    if hashlib.sha256(json.dumps(used,sort_keys=True).encode()).hexdigest()!=old['history_sha256']:raise ValueError('Training input differs from frozen v5 input')
    ids=sorted({r['product_id'] for r in used});series={p:engine.Series() for p in ids}
    for r in used:series[r['product_id']][date.fromisoformat(r['date'])]=r
    return series,ids,origin


def experiment_predictions(data,outlet,cutoff,horizon,old):
    series,ids,origin=context(data,outlet,cutoff,old)
    start=date.fromisoformat(cutoff);targets=[start+timedelta(days=i) for i in range(horizon)]
    estimates=statistical_predictions(series,ids,origin,targets)
    chosen,selection=select_from_past(series,ids,origin,horizon,(start-origin).days-1)
    values={m:estimates[m] for m in (*INTERMITTENT,*HIERARCHICAL)}
    values['past-selected-stat']=estimates[chosen]
    pooled=global_onehot(series,ids,origin,targets)
    if pooled is None:raise ValueError('Global candidate unavailable; do not score unequal samples')
    values['global-xgb-onehot']=pooled
    output={m:[dict(date=d.isoformat(),product_id=p,predicted_qty=round(float(v),3)) for p in ids for d,v in zip(targets,est[p])] for m,est in values.items()}
    keys={(r['date'],r['product_id']) for r in old['predictions']['auto']}
    if any({(r['date'],r['product_id']) for r in rows}!=keys for rows in output.values()):raise ValueError('Unequal prediction coverage')
    return dict(cutoff=cutoff,horizon=horizon,history_sha256=old['history_sha256'],predictions=output,
                selected_method=chosen,selection=selection)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',type=Path,default=Path('.local/public-datasets/ihelon-coffee-sales/evaluation'))
    parser.add_argument('--archive',type=Path,default=Path('.local/public-datasets/ihelon-coffee-sales/original.zip'))
    parser.add_argument('--output',type=Path,default=Path('.local/public-datasets/ihelon-coffee-sales/sparse-investigation-v1'))
    args=parser.parse_args()
    reference=json.loads(Path('docs/research/coffee-sales-v5-results.json').read_text())
    old_protocol=json.loads((args.baseline/'protocol.json').read_text());data=json.loads((args.baseline/'prepared-frozen.json').read_bytes())
    if reference['protocol']!=old_protocol or digest(args.baseline/'prepared-frozen.json')!=old_protocol['prepared_sha256'] or digest(engine.__file__)!=old_protocol['engine_sha256']:
        raise ValueError('Reference data, protocol or production engine changed')
    for item in reference['frozen_prediction_files']:
        if digest(args.baseline/item['file'])!=item['sha256']:raise ValueError('Prior prediction file changed')
    protocol=dict(format='coffee-sparse-investigation-v1',reference_protocol=old_protocol,
                  code_sha256={p.name:digest(p) for p in [Path(__file__),Path(__file__).with_name('sparse_candidates.py')]},
                  candidates=list(NEW_MODELS),alpha=.1,tsb_beta=.1,share_window_days=28,weekday_share_days=56,
                  global_xgb='Same v5 pooled Poisson training rows/features/hyperparameters, except ordinal product index replaced with one-hot product indicators.',
                  selector='Prior-only batch MAE across existing statistical and new intermittent/top-down methods, reserved calibration separation as in v5; XGBoost evaluated independently.',
                  gate='Research only. Compare with v5 AND the best fixed existing statistical candidate, check folds/horizons/products/bias; known public outcomes require independent confirmation before production promotion.',
                  data_policy='Unchanged observed/inferred-zero actuals; missing records remain unknown. No new dataset, no DB/production writes.')
    args.output.mkdir(parents=True,exist_ok=True);protocol_path=args.output/'protocol.json'
    if protocol_path.exists():
        if json.loads(protocol_path.read_text())!=protocol:raise ValueError('Changed experiment protocol; use a new directory')
    else:
        with protocol_path.open('x',encoding='utf-8') as out:json.dump(protocol,out,indent=2)
    report=dict(protocol=protocol,audit=audit_data(data,args.archive,old_protocol['cutoffs']['1'][0]),models={},by_product={},selection={},fold_scores={},new_prediction_files=[])
    names={p['id']:p['name'] for p in data['products']}
    for h in (1,7,30):
        by_model=defaultdict(list);selection_rows=[];fold_scores=[]
        for number,cutoff in enumerate(old_protocol['cutoffs'][str(h)]):
            old_path=args.baseline/f'predictions-{h}-{cutoff}.json';old=json.loads(old_path.read_text())
            path=args.output/f'predictions-{h}-{cutoff}.json'
            if path.exists():
                new=json.loads(path.read_text())
                if new['protocol_sha256']!=digest(protocol_path) or new['reference_prediction_sha256']!=digest(old_path):raise ValueError('Frozen experiment identity differs')
            else:
                new=experiment_predictions(data,old_protocol['outlet'],cutoff,h,old)
                new.update(protocol_sha256=digest(protocol_path),reference_prediction_sha256=digest(old_path),executed_at=datetime.now(timezone.utc).isoformat())
                with path.open('x',encoding='utf-8') as out:json.dump(new,out)
            # Withheld actuals are read for scoring only after the new predictions are saved.
            end=(date.fromisoformat(cutoff)+timedelta(days=h-1)).isoformat()
            truth={(r['date'],r['product_id']):r['qty'] for r in data['daily'] if r['outlet_id']==old_protocol['outlet'] and cutoff<=r['date']<=end}
            merged={**old['predictions'],**new['predictions']}
            for method,points in merged.items():
                rows=[dict(cutoff=cutoff,date=p['date'],product_id=p['product_id'],predicted=p['predicted_qty'],actual=truth.get((p['date'],p['product_id']))) for p in points]
                by_model[method]+=rows;fold_scores.append(dict(cutoff=cutoff,method=method,**scores(rows)))
            seen=set()
            for p in old['predictions']['auto']:
                if p['product_id'] in seen:continue
                seen.add(p['product_id']);method=p['model_version']
                selection_rows.append(dict(cutoff=cutoff,product_id=p['product_id'],product_name=names[p['product_id']],
                                           method='global-xgb-ordinal' if method.startswith('coffee-direct') else method,
                                           validation_origins=p['diagnostics'].get('validation_origins'),validation=p['diagnostics']['selection']))
            selection_rows.append(dict(cutoff=cutoff,product_id='ALL',product_name='Batch research selector',method=new['selected_method'],validation=new['selection']))
            report['new_prediction_files'].append(dict(file=path.name,sha256=digest(path)))
            print(f'horizon={h} fold={number+1}/{len(old_protocol["cutoffs"][str(h)])} cutoff={cutoff}',flush=True)
        report['models'][str(h)]={m:scores(rows) for m,rows in by_model.items()}
        # Reproduce all previously published metrics on precisely the same outcomes.
        for method,expected in reference['models'][str(h)].items():
            for scope in ['product_day','daily_total']:
                for metric,value in expected[scope].items():
                    actual=report['models'][str(h)][method][scope][metric]
                    if (value is None)!=(actual is None) or value is not None and not math.isclose(value,actual,abs_tol=1e-9):raise ValueError('Baseline results changed')
        report['by_product'][str(h)]={m:[dict(product_id=p['id'],name=p['name'],**scores([r for r in rows if r['product_id']==p['id']])['product_day']) for p in data['products']] for m,rows in by_model.items()}
        report['selection'][str(h)]=selection_rows;report['fold_scores'][str(h)]=fold_scores
    (args.output/'results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    md=['# Sparse-demand experiment: identical frozen rolling periods','', 'All columns use the unchanged recorded-sales outcomes and original fold masks. These are retrospective research comparisons, not new-shop validation.','']
    fmt=lambda v:'—' if v is None else f'{v:.4f}'
    for h,models in report['models'].items():
        md += [f'## {h}-day horizon','', '| Method | Product pairs | MAE | RMSE | WAPE % | Bias | Total days | Total MAE | Total RMSE | Total WAPE % | Total Bias |','|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
        for method,scopes in models.items():
            p,t=scopes['product_day'],scopes['daily_total']
            md.append('| '+method+' | '+str(p['samples'])+' | '+' | '.join(fmt(p[k]) for k in ['mae','rmse','wape','bias'])+' | '+str(t['samples'])+' | '+' | '.join(fmt(t[k]) for k in ['mae','rmse','wape','bias'])+' |')
        md+=['','| Product | v5 selection counts (one vote/origin) |','|---|---|']
        for p in data['products']:
            counts=Counter(r['method'] for r in report['selection'][h] if r['product_id']==p['id'])
            md.append('| '+p['name']+' | '+', '.join(f'{m}: {n}' for m,n in counts.most_common())+' |')
        md+=['']
    (args.output/'comparison.md').write_text('\n'.join(md),encoding='utf-8')


if __name__=='__main__':main()
