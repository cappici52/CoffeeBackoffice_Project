"""ProjectA v4 XGBoost inference with the original daily lag features.

Forecast generation can train a local candidate; dashboard reads stay cached in PostgreSQL.
"""
from datetime import date, timedelta
import hashlib
import json
import math
from pathlib import Path
from statistics import mean

import numpy as np
from xgboost import Booster, DMatrix

ARTIFACTS = Path(__file__).parent / "artifacts"
MANIFEST = json.loads((ARTIFACTS / "manifest.json").read_text(encoding="utf-8"))
MODEL_VERSION = MANIFEST["model_version"]
FEATURES = ["lag_1", "lag_7", "lag_14", "lag_28", "mean_7", "mean_28", "weekday", "month", "unit_price"]
if MANIFEST["features"] != FEATURES:
    raise RuntimeError("Forecast model feature schema mismatch")
if hashlib.sha256((ARTIFACTS / "model.json").read_bytes()).hexdigest() != MANIFEST["model_sha256"]:
    raise RuntimeError("Forecast model checksum mismatch")
MODEL = Booster(params={"nthread": 2})
MODEL.load_model(bytearray((ARTIFACTS / "model.json").read_bytes()))
MODEL.set_param({"nthread": 2})
if MODEL.feature_names != FEATURES:
    raise RuntimeError("Forecast model features do not match manifest")


class InsufficientHistory(ValueError):
    pass


def recursive_forecast(histories, prices, origin, days, model=MODEL):
    """Batch independent product series while retaining unrounded feedback."""
    histories = [values.copy() for values in histories]
    result = [[] for _ in histories]
    for offset in range(1, days + 1):
        target = origin + timedelta(days=offset)
        features = np.array([
            [h[-1], h[-7], h[-14], h[-28], mean(h[-7:]), mean(h[-28:]),
             target.weekday(), target.month, price]
            for h, price in zip(histories, prices)
        ], dtype=np.float32)
        predictions = model.predict(DMatrix(features, feature_names=FEATURES, nthread=2))
        for i, value in enumerate(predictions):
            quantity = float(value)
            if not math.isfinite(quantity) or quantity > 1_000_000:
                raise ValueError("Model prediction is outside supported quantity bounds")
            quantity = max(0.0, quantity)
            result[i].append(quantity)
            histories[i].append(quantity)
    return result


def predict(date_from, date_to, product_ids, history):
    start, end = date.fromisoformat(date_from), date.fromisoformat(date_to)
    if not 0 <= (end - start).days < 30:
        raise ValueError("Forecast range must be 1-30 days")
    if not product_ids or len(set(product_ids)) != len(product_ids):
        raise ValueError("Products must be nonempty and unique")
    observed = {}
    for row in history:
        day = date.fromisoformat(row["date"])
        if day >= start or row["product_id"] not in product_ids:
            continue
        key = (day, row["product_id"])
        if key in observed:
            raise ValueError("Duplicate daily product observations")
        if not math.isfinite(row["qty"]) or not 0 <= row["qty"] <= 1_000_000:
            raise ValueError("Invalid historical quantity")
        if not math.isfinite(row["unit_price"]) or not 0 <= row["unit_price"] <= 20_000_000:
            raise ValueError("Invalid historical unit price")
        observed[key] = row
    if not observed:
        raise InsufficientHistory("At least 28 observed daily sales per product are required")
    # An unclosed/latest day may have sales for only some menus. Use the newest
    # day observed for every requested menu, rather than inventing zero sales
    # for the others or letting one newer menu block otherwise usable history.
    dates_by_product = {product: set() for product in product_ids}
    for day, product in observed:
        dates_by_product[product].add(day)
    common_days = set.intersection(*dates_by_product.values())
    if not common_days:
        raise InsufficientHistory("Requested products have no common observed daily sales")
    origin = max(common_days)
    if (start - origin).days > 7:
        raise InsufficientHistory("Latest daily sales are too old; update sales history")
    histories, prices, price_histories, sources = [], [], [], []
    for product_id in product_ids:
        window = [observed.get((origin - timedelta(days=offset), product_id)) for offset in range(27, -1, -1)]
        if any(row is None for row in window):
            raise InsufficientHistory("Every product needs 28 consecutive observed days ending at the forecast origin")
        # Keep up to 120 consecutive observed days for optional local training;
        # missing days remain unknown instead of silently becoming zero sales.
        previous = origin - timedelta(days=28)
        while len(window) < 120 and (previous, product_id) in observed:
            window.insert(0, observed[(previous, product_id)])
            previous -= timedelta(days=1)
        histories.append([float(row["qty"]) for row in window])
        prices.append(float(window[-1]["unit_price"]))
        price_histories.append([float(row["unit_price"]) for row in window])
        sources.append(sorted({row.get("source", "unknown") for row in window}))
    # Predict unobserved days before the requested range, too. Never relabel a
    # day-ahead result as a later day or fill missing historical days with zero.
    from selection import selected_forecasts, choose
    predictions, versions = selected_forecasts(histories, prices, price_histories, origin, (end - origin).days, product_ids, sources)
    snapshot = json.dumps({"origin": origin.isoformat(), "histories": histories, "price_histories": price_histories, "product_ids": product_ids, "sources": sources}, sort_keys=True)
    selection_scores = {row["product_id"]: row for row in choose(snapshot)[2]}
    def source_label(index, version):
        used = {s for group in sources for s in group} if version.startswith("coffee-xgb-") else set(sources[index])
        return next(iter(used)) if len(used) == 1 and used <= {"actual", "demo"} else "mixed"
    return [dict(date=(origin + timedelta(days=offset + 1)).isoformat(), product_id=product_id,
                 predicted_qty=round(quantity, 3), lower=None, upper=None, model_version=version,
                 history_source=source_label(index, version),
                 diagnostics={"origin": origin.isoformat(), "history_days": len(histories[index]),
                   "reason": "rolling_validation_2_origins" if product_id in selection_scores else "short_history_weekly",
                   "selection": selection_scores.get(product_id, {}).get("selection_metrics", {})})
            for index, (product_id, quantities, version) in enumerate(zip(product_ids, predictions, versions))
            for offset, quantity in enumerate(quantities)
            if origin + timedelta(days=offset + 1) >= start]
