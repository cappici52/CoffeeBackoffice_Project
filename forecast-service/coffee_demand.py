"""Currency-independent drink-transaction forecasting for external transfer.

The input and target are relative to the *prior* 28-day mean. Foreign money
values are never interpreted as Thai prices, and no customer identifiers enter.
"""
from datetime import timedelta
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from xgboost import Booster, DMatrix, train

FEATURES = ["relative_lag_1", "relative_lag_7", "relative_lag_14", "relative_lag_28",
            "relative_mean_7", "weekday", "month"]
BUNDLE = Path(__file__).parent / "evaluations" / "coffee-sales"


def features(history, target):
    prior = history[-28:]
    if len(prior) != 28 or any(not math.isfinite(v) or v < 0 for v in prior):
        raise ValueError("Demand features require 28 finite, nonnegative observed days")
    scale = float(np.mean(prior))
    denominator = max(scale, 1e-6)
    return [prior[-1] / denominator, prior[-7] / denominator,
            prior[-14] / denominator, prior[-28] / denominator,
            float(np.mean(prior[-7:])) / denominator, target.weekday(), target.month], scale


def training_rows(series, cutoff):
    """Only complete calendar windows; absent machine days remain unknown."""
    inputs, labels = [], []
    for observations in series.values():
        for target in sorted(d for d in observations if d <= cutoff):
            dates = [target - timedelta(days=offset) for offset in range(28, 0, -1)]
            if any(day not in observations for day in dates):
                continue
            row, scale = features([observations[day] for day in dates], target)
            if scale <= 0:
                continue
            inputs.append(row)
            labels.append(observations[target] / scale)
    return np.array(inputs, dtype=np.float32), np.array(labels, dtype=np.float32)


def fit(series, cutoff, objective="count:poisson"):
    inputs, labels = training_rows(series, cutoff)
    if len(labels) < 100:
        raise ValueError("Not enough complete external training windows")
    return train({"objective": objective, "max_depth": 3, "eta": .05,
                  "subsample": .85, "colsample_bytree": .8, "min_child_weight": 5,
                  "lambda": 5, "seed": 42, "nthread": 2},
                 DMatrix(inputs, label=labels, feature_names=FEATURES, nthread=2),
                 num_boost_round=220)


def forecast(booster, histories, origin, days):
    histories = [values.copy() for values in histories]
    results = [[] for _ in histories]
    for offset in range(1, days + 1):
        target = origin + timedelta(days=offset)
        rows, scales = zip(*(features(history, target) for history in histories))
        ratios = booster.predict(DMatrix(np.array(rows, dtype=np.float32), feature_names=FEATURES, nthread=2))
        for index, (ratio, scale) in enumerate(zip(ratios, scales)):
            value = float(ratio) * scale
            if not math.isfinite(value) or value > 1_000_000:
                raise ValueError("External model produced an invalid quantity")
            value = max(0.0, value)
            histories[index].append(value)
            results[index].append(value)
    return results


def load_bundle(directory=BUNDLE):
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    data = (directory / "model.json").read_bytes()
    if manifest["features"] != FEATURES or hashlib.sha256(data).hexdigest() != manifest["model_sha256"]:
        raise RuntimeError("External coffee model checksum/schema mismatch")
    booster = Booster()
    booster.load_model(bytearray(data))
    booster.set_param({"nthread": 2})
    if booster.feature_names != FEATURES:
        raise RuntimeError("External coffee estimator features do not match manifest")
    return booster, manifest
