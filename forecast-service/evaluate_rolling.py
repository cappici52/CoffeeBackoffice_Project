"""Prior-only rolling comparison on de-identified real Coffee Sales data.

This is reanalysis of a previously examined public dataset, not a new blind
holdout and not permission to deploy its estimator into a different shop.
"""
import argparse
import csv
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import platform

import numpy as np
import xgboost
from coffee_demand import fit, forecast
from selection import baseline, evaluation, STATISTICAL_METHODS


def evaluate(path):
    manifest = json.loads((Path(__file__).parent / "evaluations/coffee-sales/manifest.json").read_text(encoding="utf-8"))
    if hashlib.sha256(path.read_bytes()).hexdigest() != manifest["provenance"]["prepared_csv_sha256"]:
        raise ValueError("Prepared data does not match the licensed source manifest")
    series = {}
    with path.open(encoding="utf-8") as source:
        for row in csv.DictReader(source):
            series.setdefault(row["product"], {})[date.fromisoformat(row["date"])] = float(row["transactions"])
    start = max(min(values) for values in series.values()) + timedelta(days=84)
    # Keep the old final 28-day holdout outside this rolling comparison entirely.
    last = min(max(values) for values in series.values()) - timedelta(days=56)
    totals = {}
    folds, skipped = [], []
    origin = start
    while origin <= last:
        prior_dates = [origin - timedelta(days=i) for i in range(27, -1, -1)]
        target_dates = [origin + timedelta(days=i) for i in range(1, 29)]
        if any(day not in values for values in series.values() for day in prior_dates + target_dates):
            skipped.append(origin.isoformat())
            origin += timedelta(days=28)
            continue
        histories = [[values[d] for d in prior_dates] for values in series.values()]
        for history, values in zip(histories, series.values()):
            previous = origin - timedelta(days=28)
            while len(history) < 120 and previous in values:
                history.insert(0, values[previous])
                previous -= timedelta(days=1)
        actual = [[values[d] for d in target_dates] for values in series.values()]
        methods = {m: [baseline(h, 28, m) for h in histories] for m in
                   STATISTICAL_METHODS}
        # The trainer itself filters dates <= origin and uses prior-only lags.
        for objective in ["count:poisson", "reg:absoluteerror"]:
            estimator = fit(series, origin, objective)
            methods["relative-xgb-" + objective] = forecast(estimator, histories, origin, 28)
        for horizon in [1, 7, 14, 28]:
            for name, estimates in methods.items():
                key = (horizon, name)
                observed, predicted = totals.setdefault(key, ([], []))
                observed.extend(value for row in actual for value in row[:horizon])
                predicted.extend(value for row in estimates for value in row[:horizon])
        folds.append(origin.isoformat())
        origin += timedelta(days=28)
    if len(folds) < 2:
        raise ValueError("At least two complete rolling windows are required")
    return {"protocol": "coffee-external-rolling-v1", "source": "https://www.kaggle.com/datasets/ihelon/coffee-sales",
            "prepared_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "origins": folds,
            "skipped_unknown_calendar_windows": skipped, "horizons": [1, 7, 14, 28],
            "evaluation_kind": "reanalysis_not_new_blind_holdout", "deployment_approved": False,
            "protocol_note": "Horizons are cumulative windows 1..h; 28-day folds do not overlap. Statistical state uses up to 120 consecutive prior days, matching the app. Fixed SES alpha=.2; Holt alpha=.3, beta=.1, phi=.9. No parameter search on the old holdout.",
            "environment": {"python": platform.python_version(), "numpy": np.__version__, "xgboost": xgboost.__version__, "platform": platform.system()},
            "metrics": [{"horizon": h, "method": name, **evaluation(*values)} for (h, name), values in sorted(totals.items())]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=Path, default=Path(__file__).parent / "evaluations/coffee-sales/daily.csv")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = evaluate(args.prepared)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"rolling_origins": len(result["origins"]), "deployment_approved": False, "output": str(args.output)}))
