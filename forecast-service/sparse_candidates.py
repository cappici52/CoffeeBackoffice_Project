"""Research-only sparse-demand candidates. Not imported by the serving engine."""
from datetime import timedelta
import math

import numpy as np
from xgboost import DMatrix, train

import engine

INTERMITTENT=('croston-a10','sba-a10','tsb-a10-b10')
HIERARCHICAL=('td-mean28-share28','td-weekday-share28','td-weekday-share-weekday56')
SELECTABLE=(*engine.METHODS,*INTERMITTENT,*HIERARCHICAL)


def croston(values,alpha=.1,correct_bias=False):
    """Intervals count observed periods only; missing periods must be omitted."""
    if not 0<alpha<=1:raise ValueError('Invalid smoothing constant')
    size=interval=None
    elapsed=0
    for value in values:
        if not math.isfinite(value) or value<0:raise ValueError('Invalid demand')
        elapsed+=1
        if value>0:
            if size is None:size,interval=value,float(elapsed)
            else:size=alpha*value+(1-alpha)*size;interval=alpha*elapsed+(1-alpha)*interval
            elapsed=0
    return 0. if size is None else size/interval*(1-alpha/2 if correct_bias else 1)


def tsb(values,alpha=.1,beta=.1):
    if not 0<alpha<=1 or not 0<beta<=1:raise ValueError('Invalid smoothing constant')
    size=probability=None
    for index,value in enumerate(values):
        if not math.isfinite(value) or value<0:raise ValueError('Invalid demand')
        if size is None:
            if value>0:size,probability=value,1./(index+1)
            continue
        probability=beta*int(value>0)+(1-beta)*probability
        if value>0:size=alpha*value+(1-alpha)*size
    # Multi-step unconditional forecasts stay constant. Do not pretend future zeros occurred.
    return 0. if size is None else size*probability


def complete_days(series,ids,origin):
    return sorted(d for d in set.intersection(*(set(series[p]) for p in ids)) if d<=origin)


def allocate(total,shares,ids):
    """Three-decimal coherent allocation; rounding residual uses largest past share."""
    total=round(max(0.,float(total)),3)
    values={p:round(total*shares[p],3) for p in ids}
    largest=max(ids,key=lambda p:shares[p])
    values[largest]=round(values[largest]+total-sum(values.values()),3)
    return values


def past_shares(series,ids,origin,target,weekday=False):
    complete=complete_days(series,ids,origin)
    days=[d for d in complete if d>origin-timedelta(days=56 if weekday else 28) and (not weekday or d.weekday()==target.weekday())]
    totals={p:sum(series[p][d]['qty'] for d in days) for p in ids}
    denominator=sum(totals.values())
    if not denominator and weekday:return past_shares(series,ids,origin,target,False)
    if not denominator:
        return {p:1./len(ids) for p in ids}
    return {p:totals[p]/denominator for p in ids}


def statistical_predictions(series,ids,origin,targets):
    output={method:engine.estimates(series,ids,origin,targets,method) for method in engine.METHODS}
    for method in INTERMITTENT:
        values={}
        for p in ids:
            observed=[r['qty'] for d,r in sorted(series[p].items()) if d<=origin]
            value=tsb(observed) if method.startswith('tsb') else croston(observed,correct_bias=method.startswith('sba'))
            values[p]=[value]*len(targets)
        output[method]=values
    days=complete_days(series,ids,origin)
    total_series={d:dict(qty=sum(series[p][d]['qty'] for p in ids),unit_price=0.) for d in days}
    for method in HIERARCHICAL:
        values={p:[] for p in ids}
        for target in targets:
            forecast=engine.stats(total_series,origin,target,'mean-28-v1' if method.startswith('td-mean28') else 'weekday-mean-v1')
            shares=past_shares(series,ids,origin,target,weekday=method.endswith('weekday56'))
            allocation=allocate(forecast,shares,ids)
            for p in ids:values[p].append(allocation[p])
        output[method]=values
    return output


def select_from_past(series,ids,origin,horizon,gap):
    """Batch-level MAE selection using the same prior selection/calibration split as v5.

    Global XGBoost is evaluated independently, not forced into this statistical selector.
    """
    calibration_origin=origin-timedelta(days=30+gap)
    calibrated=any(sum(d<=calibration_origin for d in series[p])>=28 and sum(calibration_origin+timedelta(days=gap)<d<=origin for d in series[p])>=20 for p in ids)
    end=calibration_origin if calibrated else origin
    backs=list(range(14,0,-1)) if horizon==1 else ([28,21,14,7] if horizon==7 else [60,30])
    errors={m:[] for m in SELECTABLE};folds=0
    for back in backs:
        cutoff=end-timedelta(days=back+gap)
        # One coherent hierarchy; skip a fold unless all requested products have history.
        if any(sum(d<=cutoff for d in series[p])<28 for p in ids):continue
        targets=[cutoff+timedelta(days=gap+i) for i in range(1,horizon+1)]
        estimates=statistical_predictions(series,ids,cutoff,targets)
        for method in SELECTABLE:
            errors[method]+=[abs(series[p][d]['qty']-value) for p in ids for d,value in zip(targets,estimates[method][p]) if d in series[p]]
        folds+=1
    means={m:sum(v)/len(v) for m,v in errors.items() if v}
    chosen=min(SELECTABLE,key=lambda m:means.get(m,float('inf'))) if means else 'mean-7-v1'
    return chosen,dict(selection_end=end.isoformat(),folds=folds,mae=means,policy='batch statistical MAE, fixed candidates, earlier targets only')


def onehot_features(series,index,ids,origin,target):
    # Same lag/calendar features as v5; replace the ordinal product index only.
    return [float(i==index) for i in range(len(ids))]+engine.features(series,index,origin,target)[1:]


def global_onehot(series,ids,origin,targets):
    x,y=[],[]
    for index,p in enumerate(ids):
        history={d:r for d,r in series[p].items() if d<=origin}
        for offset,cutoff in enumerate(sorted(history)):
            if offset<27:continue
            for lead in (1,7,14,30):
                target=cutoff+timedelta(days=lead)
                if target in history:
                    x.append(onehot_features(series[p],index,ids,cutoff,target));y.append(history[target]['qty'])
    if len(y)<60 or not any(y):return None
    names=[f'product_{i}' for i in range(len(ids))]+engine.FEATURES[1:]
    model=train(dict(objective='count:poisson',max_depth=3,eta=.06,min_child_weight=5,reg_lambda=5,seed=42,nthread=2),
                DMatrix(np.asarray(x,dtype=np.float32),label=y,feature_names=names,nthread=2),num_boost_round=120)
    matrix=[onehot_features(series[p],index,ids,origin,target) for index,p in enumerate(ids) for target in targets]
    values=model.predict(DMatrix(np.asarray(matrix,dtype=np.float32),feature_names=names,nthread=2))
    return {p:[max(0.,float(v)) for v in values[index*len(targets):(index+1)*len(targets)]] for index,p in enumerate(ids)}
