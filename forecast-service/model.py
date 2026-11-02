"""Deterministic mock adapter. Replace predict() with the real model later."""
from datetime import date, timedelta
from statistics import mean

MODEL_VERSION = "mock-weekday-v1"

def predict(date_from, date_to, product_ids, history):
    start, end = date.fromisoformat(date_from), date.fromisoformat(date_to)
    if not 0 <= (end - start).days < 30:
        raise ValueError("Forecast range must be 1-30 days")
    values = {(h["date"], h["product_id"]): float(h["qty"]) for h in history if h["date"] < date_from}
    known_dates = [date.fromisoformat(h["date"]) for h in history if h["date"] < date_from]
    train_start = max(min(known_dates), start - timedelta(days=56)) if known_dates else start
    rows = []
    for product_id in product_ids:
        for offset in range((end - start).days + 1):
            target = start + timedelta(days=offset)
            samples = []
            training_day = train_start
            while training_day < start:
                if training_day.weekday() == target.weekday():
                    samples.append(values.get((training_day.isoformat(), product_id), 0.0))
                training_day += timedelta(days=1)
            predicted = round(mean(samples), 3) if samples else 0.0
            rows.append(dict(date=target.isoformat(), product_id=product_id, predicted_qty=predicted,
                             lower=round(predicted * .8, 3), upper=round(predicted * 1.2, 3), model_version=MODEL_VERSION))
    return rows
