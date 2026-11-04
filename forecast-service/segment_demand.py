"""Past-only demand segmentation on preserved research predictions. No serving imports/writes."""
import argparse
from collections import Counter, defaultdict
from datetime import date, timedelta
import json
import math
from pathlib import Path

from evaluate_research import scores
from investigate_sparse import context, demand_stats, digest

SEGMENTS=('Fast-moving','Medium-moving','Slow-moving','Very sparse')
RULES={'very_sparse': 'positive fraction < .35 OR mean < .5',
       'slow': 'otherwise positive fraction < .60 OR mean < 1',
       'medium': 'otherwise positive fraction < .80 OR mean < 2',
       'fast': 'otherwise', 'minimum_observations':28}


def usable(row):
    # Flags are an explicit research contract, not inferred from low sales.
    return (row.get('quality') not in {'missing','stockout','incomplete'}
            and row.get('stockout') is not True
            and row.get('is_complete_day') is not False
            and row.get('business_day_complete') is not False)


def classify(rows,origin):
    end=date.fromisoformat(origin) if isinstance(origin,str) else origin
    history=[r for r in rows if end-timedelta(days=179)<=date.fromisoformat(r['date'])<=end and usable(r)]
    stats=demand_stats(history)
    if stats['observations']<28:return dict(segment='Insufficient history',**stats)
    frequency=stats['positive_periods']/stats['observations'];mean=stats['mean']
    if frequency<.35 or mean<.5:segment='Very sparse'
    elif frequency<.60 or mean<1:segment='Slow-moving'
    elif frequency<.80 or mean<2:segment='Medium-moving'
    else:segment='Fast-moving'
    return dict(segment=segment,positive_fraction=frequency,**stats)


def select_earlier(completed,segment,origin,methods):
    # Only fully elapsed earlier outer folds; no current/partial target window.
    eligible=[f for f in completed if f['end']<=origin]
    values={m:[r for f in eligible for r in f['rows'][m] if r['segment']==segment and r['actual'] is not None] for m in methods}
    origins={r['cutoff'] for r in values[methods[0]]}
    if len(origins)<3 or len(values[methods[0]])<20:return 'weekday-mean-v1'
    return min(methods,key=lambda m:(scores(values[m])['product_day']['mae'],m))


def weighted_metrics(rows):
    """Actual-volume weights for reporting only; zero-volume products have zero weight."""
    groups=defaultdict(list)
    for row in rows:
        if row['actual'] is not None:groups[row['product_id']].append(row)
    volume={p:sum(r['actual'] for r in group) for p,group in groups.items()};total=sum(volume.values())
    if not total:return dict(actual_volume=total,mae=None,rmse=None,bias=None)
    metrics={p:scores(group)['product_day'] for p,group in groups.items()}
    return dict(actual_volume=total,
                mae=sum(volume[p]*m['mae'] for p,m in metrics.items())/total,
                rmse=math.sqrt(sum(volume[p]*m['rmse']**2 for p,m in metrics.items())/total),
                bias=sum(volume[p]*m['bias'] for p,m in metrics.items())/total)


def analyze(data,baseline,experiment,reference,sparse):
    protocol=reference['protocol']
    if sparse['protocol']['reference_protocol']!=protocol:raise ValueError('Research protocols differ')
    if digest(baseline/'prepared-frozen.json')!=protocol['prepared_sha256']:raise ValueError('Frozen input changed')
    for root,files in [(baseline,reference['frozen_prediction_files']),(experiment,sparse['new_prediction_files'])]:
        for item in files:
            if digest(root/item['file'])!=item['sha256']:raise ValueError('Frozen predictions changed')
    output=dict(protocol=dict(format='coffee-demand-segments-v1',rules=RULES,
                source_protocol=protocol,selection='3 fully elapsed earlier origins and 20 observed pairs per segment, pooled MAE; otherwise weekday average',
                quality='Missing/flagged stockout/incomplete periods excluded equally; unflagged active-day product zeros retain previous inference. No source availability flags exist.',
                promotion='Research only; same known outcomes, no production promotion'),assignments={},models={},by_product={},selection={},fold_scores={},volume_weighted={})
    for h,cutoffs in protocol['cutoffs'].items():
        assignments=[];by_model=defaultdict(list);completed=[];selection=[];fold_scores=[]
        for cutoff in cutoffs:
            old=json.loads((baseline/f'predictions-{h}-{cutoff}.json').read_text())
            new=json.loads((experiment/f'predictions-{h}-{cutoff}.json').read_text())
            _,ids,origin=context(data,protocol['outlet'],cutoff,old)
            histories={p:[r for r in data['daily'] if r['outlet_id']==protocol['outlet'] and r['product_id']==p and r['date']<cutoff] for p in ids}
            groups={p:classify(rows,origin) for p,rows in histories.items()}
            names={p['id']:p['name'] for p in data['products']}
            for p,s in groups.items():assignments.append(dict(cutoff=cutoff,origin=origin.isoformat(),product_id=p,name=names[p],**s))
            candidates={**old['predictions'],**new['predictions']};methods=sorted(candidates)
            keys={(p['date'],p['product_id']) for p in candidates['auto']}
            if any({(p['date'],p['product_id']) for p in points}!=keys for points in candidates.values()):raise ValueError('Unequal coverage')
            choices={segment:select_earlier(completed,segment,origin.isoformat(),methods) for segment in sorted({s['segment'] for s in groups.values()})}
            for segment,method in choices.items():selection.append(dict(cutoff=cutoff,segment=segment,method=method))
            lookup={m:{(p['date'],p['product_id']):p for p in points} for m,points in candidates.items()}
            candidates['past-segment-selector']=[lookup[choices[groups[p]['segment']]][(d,p)] for d,p in sorted(keys)]
            # Current held-out values are accessed only after groups/choices are fixed.
            truth={(r['date'],r['product_id']):r['qty'] for r in data['daily'] if r['outlet_id']==protocol['outlet'] and usable(r)}
            fold={}
            for m,points in candidates.items():
                rows=[dict(cutoff=cutoff,date=p['date'],product_id=p['product_id'],segment=groups[p['product_id']]['segment'],predicted=p['predicted_qty'],actual=truth.get((p['date'],p['product_id']))) for p in points]
                by_model[m]+=rows;fold[m]=rows
                for segment in SEGMENTS:
                    fold_scores.append(dict(cutoff=cutoff,segment=segment,method=m,**scores([r for r in rows if r['segment']==segment])))
            completed.append(dict(end=(date.fromisoformat(cutoff)+timedelta(days=int(h)-1)).isoformat(),rows=fold))
        output['assignments'][h]=assignments;output['selection'][h]=selection;output['fold_scores'][h]=fold_scores
        output['models'][h]={segment:{m:scores([r for r in rows if segment=='ALL' or r['segment']==segment]) for m,rows in by_model.items()} for segment in (*SEGMENTS,'ALL')}
        output['volume_weighted'][h]={segment:{m:weighted_metrics([r for r in rows if segment=='ALL' or r['segment']==segment]) for m,rows in by_model.items()} for segment in (*SEGMENTS,'ALL')}
        output['by_product'][h]={m:[dict(product_id=p['id'],name=p['name'],**scores([r for r in rows if r['product_id']==p['id']])['product_day']) for p in data['products']] for m,rows in by_model.items()}
        for m,expected in sparse['models'][h].items():
            if output['models'][h]['ALL'][m]!=expected:raise ValueError('Existing metrics changed; review quality mask or inputs')
    return output


def markdown(result):
    lines=['# Demand category model comparisons','', 'Segments are assigned separately at each origin using only its prior history. WAPE pools product/date errors (actual-volume weighted); total metrics sum within the same segment/date. Negative Bias means underforecasting. No production selection is changed.','']
    fmt=lambda v:'—' if v is None else f'{v:.4f}'
    for h,segments in result['models'].items():
        for segment,methods in segments.items():
            lines += [f'## {h}-day: {segment}','','| Method | Pairs | Actual volume | MAE | RMSE | WAPE % | Bias | Total MAE | Total RMSE | Total WAPE % | Total Bias |','|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
            for m,metrics in methods.items():
                p,t=metrics['product_day'],metrics['daily_total']
                # Actual volume comes from the same matched product rows (not rounded metric inversion).
                volume=result['volumes'][h][segment]
                lines.append('| '+' | '.join([m,str(p['samples']),str(volume),*[fmt(p[k]) for k in ('mae','rmse','wape','bias')],*[fmt(t[k]) for k in ('mae','rmse','wape','bias')]])+' |')
            lines+=['']
    return '\n'.join(lines)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',type=Path,default=Path('.local/public-datasets/ihelon-coffee-sales/evaluation'))
    parser.add_argument('--experiment',type=Path,default=Path('.local/public-datasets/ihelon-coffee-sales/sparse-investigation-v1'))
    parser.add_argument('--output',type=Path,default=Path('.local/public-datasets/ihelon-coffee-sales/segmentation-v2'))
    args=parser.parse_args()
    reference=json.loads(Path('docs/research/coffee-sales-v5-results.json').read_text())
    sparse=json.loads(Path('docs/research/coffee-sales-sparse-results.json').read_text())
    data=json.loads((args.baseline/'prepared-frozen.json').read_bytes())
    result=analyze(data,args.baseline,args.experiment,reference,sparse)
    # Volume is a reporting outcome, never an input to grouping/selection.
    truth={(r['date'],r['product_id']):r['qty'] for r in data['daily'] if r['outlet_id']==reference['protocol']['outlet'] and usable(r)}
    result['volumes']={}
    for h,rows in result['assignments'].items():
        counts=Counter()
        for row in rows:
            for i in range(int(h)):
                key=((date.fromisoformat(row['cutoff'])+timedelta(days=i)).isoformat(),row['product_id'])
                if key in truth:counts[row['segment']]+=truth[key];counts['ALL']+=truth[key]
        result['volumes'][h]={s:counts[s] for s in (*SEGMENTS,'ALL')}
    result['protocol']['code_sha256']=digest(Path(__file__))
    args.output.mkdir(parents=True,exist_ok=True)
    path=args.output/'results.json';raw=json.dumps(result,indent=2)
    if path.exists() and path.read_text(encoding='utf8')!=raw:raise ValueError('Existing experiment differs; use new output directory')
    path.write_text(raw,encoding='utf8')
    (args.output/'comparison.md').write_text(markdown(result),encoding='utf8')
    print(f'Wrote {args.output}; all existing metrics reproduced, production untouched.')


if __name__=='__main__':main()
