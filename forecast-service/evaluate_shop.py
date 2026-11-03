"""Reproducible retrospective comparison. Never writes forecasts or shop sales.

Input: JSON from the authenticated /api/forecasts/data endpoint (private).
The dataset has already been examined: results are not a new blind holdout.
"""
import argparse
from datetime import date,timedelta
import hashlib
import json
from pathlib import Path

from engine import predict,stats
from model import predict as legacy_predict, InsufficientHistory


def summarize(pairs):
    from engine import metrics
    result=metrics([(r['actual'],r['predicted']) for r in pairs])
    positive=[r for r in pairs if r['actual']>0]
    result['mape']=sum(abs((r['predicted']-r['actual'])/r['actual']) for r in positive)/len(positive)*100 if positive else None
    bounded=[r for r in pairs if r.get('lower') is not None]
    result['interval_samples']=len(bounded)
    result['interval_coverage']=100*sum(r['lower']<=r['actual']<=r['upper'] for r in bounded)/len(bounded) if bounded else None
    result['interval_mean_width']=sum(r['upper']-r['lower'] for r in bounded)/len(bounded) if bounded else None
    return result


def evaluate(bundle):
    rows=bundle['rows'];ids=sorted({r['product_id'] for r in rows})
    history=[{k:r[k] for k in ('date','product_id','qty','unit_price','source')} for r in rows]
    end=max(date.fromisoformat(r['date']) for r in history)
    observed={(r['date'],r['product_id']):r['qty'] for r in history}
    results=[]
    for horizon,backs in [(1,[60,50,40,30,20,10]),(7,[56,42,28,14]),(30,[60,30])]:
        pairs={m:[] for m in ('v4','legacy_v3','weekly','mean28')};folds=[]
        for back in backs:
            origin=end-timedelta(days=back)
            training=[r for r in history if r['date']<=origin.isoformat()]
            start,stop=origin+timedelta(days=1),origin+timedelta(days=horizon)
            current=predict(start.isoformat(),stop.isoformat(),ids,training,bundle['cohort'])
            try:
                legacy=legacy_predict(start.isoformat(),stop.isoformat(),ids,training)
                skipped_legacy=None
            except InsufficientHistory as error:
                legacy=[]
                skipped_legacy=str(error)
            series={p:{date.fromisoformat(r['date']):r for r in training if r['product_id']==p} for p in ids}
            fold={m:[] for m in pairs}
            for method,forecasts in [('v4',current),('legacy_v3',legacy)]:
                for r in forecasts:
                    actual=observed.get((r['date'],r['product_id']))
                    if actual is not None:fold[method].append(dict(actual=actual,predicted=r['predicted_qty'],lower=r.get('lower'),upper=r.get('upper')))
            for r in current:
                actual=observed.get((r['date'],r['product_id']))
                if actual is not None:
                    for name,method in [('weekly','weekly-naive-v1'),('mean28','mean-28-v1')]:
                        fold[name].append(dict(actual=actual,predicted=stats(series[r['product_id']],origin,date.fromisoformat(r['date']),method)))
            for method in pairs:pairs[method]+=fold[method]
            folds.append({'origin':origin.isoformat(),'targets':[start.isoformat(),stop.isoformat()],'skipped_legacy':skipped_legacy,
                          'scores':{m:summarize(v) for m,v in fold.items()}})
            print(f'Completed horizon={horizon}, origin={origin}',flush=True)
        results.append({'horizon':horizon,'folds':folds,'scores':{m:summarize(v) for m,v in pairs.items()}})
    return {'kind':'posthoc_retrospective_not_blind_holdout','cohort':bundle['cohort'],
            'policy':'fixed folds and parameters; identical targets; no outcome-driven retuning',
            'data_sha256':hashlib.sha256(json.dumps(history,sort_keys=True).encode()).hexdigest(),
            'results':results}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('input',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args();report=evaluate(json.loads(args.input.read_text(encoding='utf-8-sig')))
    args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps([{'horizon':r['horizon'],'scores':r['scores']} for r in report['results']],indent=2))
