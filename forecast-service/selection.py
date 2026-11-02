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

PIPELINE_VERSION = "coffee-selection-v1"
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


@lru_cache(maxsize=4)
def choose(snapshot):
    """The immutable snapshot key also versions retraining and model artifacts."""
    from datetime import date
    data = json.loads(snapshot)
    origin = date.fromisoformat(data["origin"])
    histories, price_histories = data["histories"], data["price_histories"]
    selected = ["weekly-naive-v1"] * len(histories)
    scores = []
    eligible = [i for i, h in enumerate(histories) if len(h) >= 84]
    if not eligible:
        return selected, None, scores
    training = [histories[i][:-28] for i in eligible]
    validation = [histories[i][-28:] for i in eligible]
    training_prices = [price_histories[i][:-28] for i in eligible]
    candidate_prices = [prices[-1] for prices in training_prices]
    validation_origin = origin - timedelta(days=28)
    candidate = fit(training, training_prices, validation_origin)
    baseline = seasonal(training, 28)
    transferred = recursive_forecast(training, candidate_prices, validation_origin, 28, MODEL)
    local = recursive_forecast(training, candidate_prices, validation_origin, 28, candidate) if candidate else None
    version = "coffee-xgb-v1-" + hashlib.sha256(snapshot.encode()).hexdigest()[:12]
    for offset, index in enumerate(eligible):
        actual = np.array(validation[offset])
        errors = {"weekly-naive-v1": float(np.mean(np.abs(actual - baseline[offset]))),
                  MODEL_VERSION: float(np.mean(np.abs(actual - transferred[offset])))}
        if local is not None:
            errors[version] = float(np.mean(np.abs(actual - local[offset])))
        # Preserve the simpler weekly method on ties and tiny numerical noise.
        best = min(errors, key=errors.get)
        selected[index] = best if errors[best] < errors["weekly-naive-v1"] - 1e-6 else "weekly-naive-v1"
        scores.append({"product_id": data["product_ids"][index], "selection_mae": errors,
                       "selected": selected[index], "validation_days": 28})
    fitted = fit([histories[i] for i in eligible], [price_histories[i] for i in eligible], origin) if version in selected else None
    persist(fitted, version, {"pipeline_version": PIPELINE_VERSION, "model_version": version if fitted else None,
                                 "origin": origin.isoformat(), "features": FEATURES,
                                 "history_sources": data["sources"], "selection": scores,
                                 "evaluation_note": "Validation selects a method; it is not an independent accuracy estimate."})
    return selected, fitted, scores


def selected_forecasts(histories, prices, price_histories, origin, days, product_ids, sources):
    snapshot = json.dumps({"origin": origin.isoformat(), "histories": histories, "price_histories": price_histories,
                           "product_ids": product_ids, "sources": sources}, sort_keys=True)
    methods, fitted, _ = choose(snapshot)
    results = seasonal(histories, days)
    for prefix, booster in [("projecta-xgb-", MODEL), ("coffee-xgb-", fitted)]:
        indices = [i for i, method in enumerate(methods) if method.startswith(prefix)]
        if indices:
            predictions = recursive_forecast([histories[i] for i in indices], [prices[i] for i in indices], origin, days, booster)
            for index, values in zip(indices, predictions):
                results[index] = values
    return results, methods
