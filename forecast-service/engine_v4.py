"""Source-separated daily forecasting with prior-only selection and calibration.

Legacy models/archives are retained for comparison; they are never overwritten.
Missing/flagged dates are absent observations, never synthetic zero demand.
"""
from datetime import date, timedelta
from functools import lru_cache
import hashlib
import json
import math

import numpy as np
from xgboost import DMatrix, train
from forecast_errors import InsufficientHistory

PIPELINE_VERSION = "coffee-demand-v4"
METHODS = ("weekly-naive-v1", "mean-7-v1", "mean-28-v1", "weekday-mean-v1", "ses-v1")
FEATURES = ["product", "lag_1", "lag_7", "lag_28", "mean_7", "mean_28", "observed_28", "weekday_mean", "weekday", "month", "lead", "price"]


def stats(series, origin, target, method):
    prior = sorted((d, r) for d, r in series.items() if d <= origin)
    values = [r["qty"] for _, r in prior]
    if not values:
        raise ValueError("No prior observations")
    recent = lambda days: [r["qty"] for d, r in prior if d > origin - timedelta(days=days)]
    weekdays = [r["qty"] for d, r in prior if d.weekday() == target.weekday() and d > origin - timedelta(days=56)]
    if method == "weekly-naive-v1":
        # Latest observed matching weekday, not the latest row's array position.
        return float(weekdays[-1] if weekdays else np.mean(recent(28) or values))
    if method == "weekday-mean-v1":
        return float(np.mean(weekdays[-4:] or recent(28) or values))
    if method in ("mean-7-v1", "mean-28-v1"):
        return float(np.mean(recent(7 if method == "mean-7-v1" else 28) or values))
    if method == "ses-v1":
        level = values[0]
        for value in values[1:]:
            level = .2 * value + .8 * level
        return float(level)
    raise ValueError("Unknown statistical method")


def features(series, product, origin, target):
    prior = {d: r for d, r in series.items() if d <= origin}
    last = prior[max(prior)]
    values = lambda days: [r["qty"] for d, r in prior.items() if d > origin - timedelta(days=days)]
    weekday = [r["qty"] for d, r in prior.items() if d.weekday() == target.weekday() and d > origin - timedelta(days=56)]
    return [product, *[prior.get(origin - timedelta(days=lag-1), {}).get("qty", np.nan) for lag in (1, 7, 28)],
            float(np.mean(values(7))) if values(7) else np.nan,
            float(np.mean(values(28))) if values(28) else np.nan, len(values(28)),
            float(np.mean(weekday)) if weekday else np.nan, target.weekday(), target.month,
            (target-origin).days, last["unit_price"]]


def fit(series, ids, cutoff):
    x, y = [], []
    for index, product in enumerate(ids):
        history = {d: r for d, r in series[product].items() if d <= cutoff}
        days = sorted(history)
        for offset, origin in enumerate(days):
            if offset < 27:
                continue
            for lead in (1, 7, 14, 30):
                target = origin + timedelta(days=lead)
                if target in history:
                    x.append(features(history, index, origin, target))
                    y.append(history[target]["qty"])
    if len(y) < 60 or not any(y):
        return None
    return train({"objective": "count:poisson", "max_depth": 3, "eta": .06,
                  "min_child_weight": 5, "lambda": 5, "seed": 42, "nthread": 2},
                 DMatrix(np.asarray(x, dtype=np.float32), label=y, feature_names=FEATURES, nthread=2),
                 num_boost_round=120)


def estimates(series, ids, origin, targets, method, booster=None):
    if method == "direct":
        x = [features(series[product], index, origin, target) for index, product in enumerate(ids) for target in targets]
        values = booster.predict(DMatrix(np.asarray(x, dtype=np.float32), feature_names=FEATURES, nthread=2))
        return {p: [max(0., float(v)) for v in values[i*len(targets):(i+1)*len(targets)]] for i, p in enumerate(ids)}
    return {p: [stats(series[p], origin, target, method) for target in targets] for p in ids}


def metrics(pairs):
    if not pairs:
        return {"mae": 0., "rmse": 0., "wape": None, "samples": 0}
    actual, predicted = np.asarray(pairs, dtype=float).T
    absolute = np.abs(actual-predicted)
    return {"mae": float(np.mean(absolute)), "rmse": float(np.sqrt(np.mean((actual-predicted)**2))),
            "wape": float(np.sum(absolute)/np.sum(actual)*100) if np.sum(actual) else None, "samples": len(pairs)}


@lru_cache(maxsize=8)
def run(snapshot):
    data = json.loads(snapshot)
    ids, horizon, gap = data["ids"], data["horizon"], data["gap"]
    series = {p: {} for p in ids}
    for r in data["history"]:
        series[r["product_id"]][date.fromisoformat(r["date"])] = r
    origin = date.fromisoformat(data["origin"])
    # Reserve the last 30 calendar target days for calibration, after selection.
    calibration_origin = origin - timedelta(days=30+gap)
    has_calibration = all(sum(d <= calibration_origin for d in series[p]) >= 28 and
                          sum(calibration_origin+timedelta(days=gap) < d <= origin for d in series[p]) >= 20 for p in ids)
    selection_end = calibration_origin if has_calibration else origin
    backs = list(range(14, 0, -1)) if horizon == 1 else ([28,21,14,7] if horizon == 7 else [60,30])
    scores = {p: {m: [] for m in (*METHODS, "direct")} for p in ids}
    fold_scores = {p: {m: [] for m in (*METHODS, "direct")} for p in ids}
    folds = 0
    policy=data.get('policy','auto')
    for back in (backs if policy=='auto' else []):
        cutoff = selection_end - timedelta(days=back+gap)
        if not all(sum(d <= cutoff for d in series[p]) >= 28 for p in ids):
            continue
        targets = [cutoff+timedelta(days=gap+i) for i in range(1,horizon+1)]
        # Every candidate sees exactly the same observed targets.
        booster = fit(series, ids, cutoff)
        for method in (*METHODS, "direct"):
            if method == "direct" and booster is None:
                continue
            predictions = estimates(series,ids,cutoff,targets,method,booster)
            for product in ids:
                pairs = [(series[product][d]["qty"], value) for d,value in zip(targets,predictions[product]) if d in series[product]]
                scores[product][method] += pairs
                if pairs:
                    fold_scores[product][method].append(metrics(pairs)["mae"])
        folds += 1
    selected, diagnostics = {}, {}
    for p in ids:
        measured = {m:metrics(pairs) for m,pairs in scores[p].items() if pairs}
        selected[p] = "weekly-naive-v1"
        if measured:
            best = min(METHODS, key=lambda m: measured[m]["mae"])
            # Require a material gain over weekly repetition to change method.
            if measured[best]["mae"] < measured["weekly-naive-v1"]["mae"] * .99:
                selected[p] = best
            direct = measured.get("direct")
            if direct and direct["samples"] == measured[best]["samples"]:
                paired = list(zip(fold_scores[p]["direct"],fold_scores[p][best]))
                wins = sum(a < b for a,b in paired)
                if len(paired) >= 2 and wins/len(paired) >= .6 and direct["mae"] < measured[best]["mae"]*.95:
                    selected[p] = "direct"
        diagnostics[p] = {"selection":measured,"validation_origins":folds}
        if policy!='auto':
            selected[p]='mean-28-v1' if policy=='mean28' else 'weekly-naive-v1'
    radii, calibration = {}, {}
    if has_calibration:
        model = fit(series,ids,calibration_origin) if "direct" in selected.values() else None
        targets = [calibration_origin+timedelta(days=gap+i) for i in range(1,31)]
        for method in set(selected.values()):
            predicted = estimates(series,ids,calibration_origin,targets,method,model)
            for p in ids:
                if selected[p] != method:
                    continue
                errors = sorted(abs(series[p][d]["qty"]-v) for d,v in zip(targets,predicted[p]) if d in series[p])
                if len(errors)>=20:
                    radii[p] = errors[min(len(errors)-1, math.ceil((len(errors)+1)*.8)-1)]
                    calibration[p] = {"samples":len(errors),"date_from":targets[0].isoformat(),"date_to":targets[-1].isoformat()}
    final_model = fit(series,ids,origin) if "direct" in selected.values() else None
    targets = [date.fromisoformat(d) for d in data["targets"]]
    output = []
    version = "coffee-direct-v4-" + hashlib.sha256(snapshot.encode()).hexdigest()[:12]
    for method in set(selected.values()):
        predicted = estimates(series,ids,origin,targets,method,final_model)
        for p in ids:
            if selected[p] != method:
                continue
            for target,value in zip(targets,predicted[p]):
                if not math.isfinite(value) or value > 1e6:
                    raise ValueError("Prediction exceeds supported bounds")
                radius = radii.get(p)
                output.append({"date":target.isoformat(),"product_id":p,"predicted_qty":round(value,3),
                    "lower":round(max(0.,value-radius),3) if radius is not None else None,
                    "upper":round(min(1e6,value+radius),3) if radius is not None else None,
                    "model_version":version if method=="direct" else method,
                    "history_source":data["source"],
                    "diagnostics":{"origin":origin.isoformat(),"history_days":len(series[p]),"horizon":horizon,"gap_days":gap,
                        "reason":"declared_baseline_policy" if policy!='auto' else "v4_prior_only_selection" if folds else "short_history_weekly",
                        **diagnostics[p],"pipeline":PIPELINE_VERSION if policy=='auto' else PIPELINE_VERSION+'-'+policy,"method_policy":policy,"training_cohort":data["cohort"],
                        "interval_kind":"empirical_absolute_80" if radius is not None else "unavailable",
                        "calibration":calibration.get(p)}})
    return sorted(output,key=lambda r:(r["date"],r["product_id"]))


def predict(date_from,date_to,product_ids,history,cohort="genuine",policy='auto'):
    start,end = date.fromisoformat(date_from),date.fromisoformat(date_to)
    if not 0 <= (end-start).days < 30 or not product_ids or len(set(product_ids)) != len(product_ids):
        raise ValueError("Invalid dates or products")
    if policy not in ('auto','mean28','weekly'):
        raise ValueError('Invalid forecasting policy')
    usable, seen = [], set()
    for row in history:
        if row["product_id"] not in product_ids or row["date"] >= date_from:
            continue
        key=(row["date"],row["product_id"])
        if key in seen:
            raise ValueError("Duplicate observations")
        seen.add(key)
        if not math.isfinite(row["qty"]) or not 0 <= row["qty"] <= 1e6 or not math.isfinite(row["unit_price"]) or not 0 <= row["unit_price"] <= 2e7:
            raise ValueError("Invalid quantity or price")
        usable.append(row)
    if any(not any(r["product_id"]==p for r in usable) for p in product_ids):
        raise InsufficientHistory("Missing product history")
    sources={r["source"] for r in usable}
    if sources not in ({"actual"},{"demo"}):
        raise ValueError("Training sources must not be blended")
    if (cohort == 'demo') != (sources == {'demo'}):
        raise ValueError("Cohort and observation source disagree")
    origin=min(max(date.fromisoformat(r["date"]) for r in usable if r["product_id"]==p) for p in product_ids)
    usable=sorted([r for r in usable if origin-timedelta(days=179) <= date.fromisoformat(r["date"]) <= origin],key=lambda r:(r["date"],r["product_id"]))
    for p in product_ids:
        values=[r for r in usable if r["product_id"]==p]
        if sum(date.fromisoformat(r["date"]) > origin-timedelta(days=56) for r in values)<28:
            raise InsufficientHistory("Need 28 usable observations in the latest 56 days")
    gap=(start-origin).days-1
    if not 0 <= gap <= 6:
        raise InsufficientHistory("Latest observation is stale")
    horizon=1 if start==end else 7 if (end-start).days<7 else 30
    return run(json.dumps({"history":usable,"ids":sorted(product_ids),"origin":origin.isoformat(),
        "gap":gap,"horizon":horizon,"cohort":cohort,"source":next(iter(sources)),"policy":policy,
        "targets":[(start+timedelta(days=i)).isoformat() for i in range((end-start).days+1)]},sort_keys=True))
