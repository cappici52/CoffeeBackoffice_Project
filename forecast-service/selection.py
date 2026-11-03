"""Select a forecasting method using prior-only, 28-day recursive validation.

ProjectA is a candidate, not an assumption that retail demand fits a coffee shop.
The optional new XGBoost candidate learns the shop's own unit quantities/prices.
"""
from datetime import timedelta
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import tempfile

import numpy as np
from xgboost import DMatrix, train

from model import FEATURES, MODEL, MODEL_VERSION, recursive_forecast

PIPELINE_VERSION = "coffee-selection-v2"
STATISTICAL_METHODS = ["weekly-naive-v1", "mean-28-v1", "mean-7-v1", "weekday-mean-v1", "ses-v1", "damped-holt-v1"]
RUNTIME = Path(os.environ.get("FORECAST_MODEL_DIR", Path(__file__).parent / "runtime"))


def seasonal(histories, days):
    results = []
    for history in histories:
        values = history.copy()
        for _ in range(days):
            values.append(values[-7])
        results.append(values[-days:])
    return results


def fit(histories, price_histories, origin):
    features, targets = [], []
    for history, prices in zip(histories, price_histories):
        for offset in range(28, len(history)):
            day = origin - timedelta(days=len(history) - 1 - offset)
            prior = history[:offset]
            features.append([prior[-1], prior[-7], prior[-14], prior[-28],
                             float(np.mean(prior[-7:])), float(np.mean(prior[-28:])),
                             day.weekday(), day.month, prices[offset]])
            targets.append(history[offset])
    if not targets or not any(targets):
        return None
    return train({"objective": "count:poisson", "max_depth": 3, "eta": .05,
                  "subsample": .85, "colsample_bytree": .8, "min_child_weight": 5,
                  "lambda": 5, "seed": 42, "nthread": 2},
                 DMatrix(np.array(features, dtype=np.float32), label=targets,
                         feature_names=FEATURES, nthread=2), num_boost_round=220)


def persist(model, version, metrics):
    RUNTIME.mkdir(parents=True, exist_ok=True)
    # Atomic replacement; concurrent workers never see a half-written model.
    if model is not None:
        with tempfile.NamedTemporaryFile(dir=RUNTIME, suffix=".json", delete=False) as output:
            temporary = Path(output.name)
        try:
            temporary.write_bytes(model.save_raw(raw_format="json"))
            os.replace(temporary, RUNTIME / (version + ".json"))
        finally:
            temporary.unlink(missing_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=RUNTIME, suffix=".json", delete=False, encoding="utf-8") as output:
        json.dump(metrics, output, indent=2)
        output.write("\n")
        temporary = Path(output.name)
    try:
        os.replace(temporary, RUNTIME / (version + ".metadata.json"))
    finally:
        temporary.unlink(missing_ok=True)


def baseline(history, days, method):
    if method == "ses-v1":
        level = float(history[0])
        for value in history[1:]:
            level = .2 * value + .8 * level
        return [max(0.0, level)] * days
    if method == "damped-holt-v1":
        # Fixed, declared parameters. Fit state from training observations only;
        # no tuning against validation/test outcomes or future prices.
        level, trend, phi = float(history[0]), 0.0, .9
        for value in history[1:]:
            previous = level
            level = .3 * value + .7 * (level + phi * trend)
            trend = .1 * (level - previous) + .9 * phi * trend
        return [max(0.0, level + sum(phi ** step for step in range(1, horizon + 1)) * trend)
                for horizon in range(1, days + 1)]
    if method == "weekly-naive-v1":
        return seasonal([history], days)[0]
    if method == "mean-28-v1":
        return [float(np.mean(history[-28:]))] * days
    if method == "mean-7-v1":
        return [float(np.mean(history[-7:]))] * days
    if method == "weekday-mean-v1":
        return [float(np.mean(history[-28:][offset % 7::7])) for offset in range(days)]
    raise ValueError("Unknown baseline")


def evaluation(actual, predicted):
    actual, predicted = np.array(actual), np.array(predicted)
    errors = np.abs(actual - predicted)
    return {"mae": float(np.mean(errors)), "rmse": float(np.sqrt(np.mean((actual-predicted)**2))),
            "wape": float(np.sum(errors)/np.sum(actual)*100) if np.sum(actual)>0 else None,
            "samples": len(actual)}


@lru_cache(maxsize=4)
def choose(snapshot):
    from datetime import date
    data = json.loads(snapshot)
    origin = date.fromisoformat(data["origin"])
    histories, price_histories = data["histories"], data["price_histories"]
    selected = ["weekly-naive-v1"] * len(histories)
    scores = []
    eligible = [i for i, h in enumerate(histories) if len(h) >= 84]
    if not eligible:
        return selected, None, scores
    methods = STATISTICAL_METHODS
    version = "coffee-xgb-v2-" + hashlib.sha256(snapshot.encode()).hexdigest()[:12]
    actuals = {i: [] for i in eligible}
    estimates = {i: {m: [] for m in methods + [MODEL_VERSION, version]} for i in eligible}
    # Two prior-only rolling origins, each forecasting 28 days. The windows
    # overlap: these are selection diagnostics, never an independent holdout.
    for back in [42, 28]:
        training = [histories[i][:-back] for i in eligible]
        training_prices = [price_histories[i][:-back] for i in eligible]
        validation_origin = origin - timedelta(days=back)
        candidate = fit(training, training_prices, validation_origin)
        prices = [p[-1] for p in training_prices]
        transferred = recursive_forecast(training, prices, validation_origin, 28, MODEL)
        local = recursive_forecast(training, prices, validation_origin, 28, candidate) if candidate else None
        for offset, index in enumerate(eligible):
            actuals[index] += histories[index][-back:][:28]
            for method in methods:
                estimates[index][method] += baseline(training[offset], 28, method)
            estimates[index][MODEL_VERSION] += transferred[offset]
            if local is not None:
                estimates[index][version] += local[offset]
    for index in eligible:
        metrics = {m: evaluation(actuals[index], values) for m, values in estimates[index].items()
                   if len(values) == len(actuals[index])}
        best = min(metrics, key=lambda m: metrics[m]["mae"])
        # Preserve the weekly baseline on ties. Do not promote a complex model
        # merely because it was trained.
        selected[index] = best if metrics[best]["mae"] < metrics["weekly-naive-v1"]["mae"] - 1e-6 else "weekly-naive-v1"
        scores.append({"product_id": data["product_ids"][index], "selection_mae": {m:v["mae"] for m,v in metrics.items()},
                       "selection_metrics": metrics, "selected": selected[index], "validation_days": 28,
                       "origins": 2, "evaluation_kind": "rolling_validation_overlapping"})
    fitted = fit([histories[i] for i in eligible], [price_histories[i] for i in eligible], origin) if version in selected else None
    persist(fitted, version, {"pipeline_version": PIPELINE_VERSION, "model_version": version if fitted else None,
                             "origin": origin.isoformat(), "features": FEATURES, "history_sources": data["sources"],
                             "selection": scores, "evaluation_note": "Rolling validation selects a method; it is not an independent test accuracy estimate."})
    return selected, fitted, scores


def selected_forecasts(histories, prices, price_histories, origin, days, product_ids, sources):
    snapshot = json.dumps({"origin": origin.isoformat(), "histories": histories, "price_histories": price_histories,
                           "product_ids": product_ids, "sources": sources}, sort_keys=True)
    methods, fitted, _ = choose(snapshot)
    results = [baseline(h, days, method) if method in STATISTICAL_METHODS else baseline(h, days, "weekly-naive-v1") for h, method in zip(histories, methods)]
    for prefix, booster in [("projecta-xgb-", MODEL), ("coffee-xgb-", fitted)]:
        indices = [i for i, method in enumerate(methods) if method.startswith(prefix)]
        if indices:
            predictions = recursive_forecast([histories[i] for i in indices], [prices[i] for i in indices], origin, days, booster)
            for index, values in zip(indices, predictions):
                results[index] = values
    return results, methods
