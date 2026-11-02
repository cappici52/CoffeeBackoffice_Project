"""Reproducible offline benchmark of the original CC0 Coffee Sales dataset.

Downloads/prepares public data only. Never connects to the shop database.
"""
import argparse
from collections import Counter
import csv
from datetime import date, timedelta
import hashlib
import io
import json
import math
import platform
from pathlib import Path
from urllib.request import urlopen
import zipfile

import numpy as np
import xgboost

from coffee_demand import FEATURES, fit, forecast

DATASET = "ihelon/coffee-sales"
SOURCE_URL = "https://www.kaggle.com/datasets/" + DATASET
DOWNLOAD_URL = "https://www.kaggle.com/api/v1/datasets/download/" + DATASET
MEMBER = "index_1.csv"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def prepare(archive):
    with zipfile.ZipFile(archive) as source:
        if source.getinfo(MEMBER).file_size > 10_000_000:
            raise ValueError("Unexpected dataset size")
        raw = source.read(MEMBER)
        rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))))
        ignored = [name for name in source.namelist() if name != MEMBER]
    counts = Counter()
    active, first = set(), {}
    seen = set()
    for row in rows:
        if set(row) != {"date", "datetime", "cash_type", "card", "money", "coffee_name"}:
            raise ValueError("Unexpected original Coffee Sales schema")
        # Detect duplicates before dropping anonymous card fields; do not use
        # card identifiers as model features or publish them in prepared data.
        key = tuple(row.items())
        if key in seen:
            raise ValueError("Duplicate raw transactions require manual review")
        seen.add(key)
        day = date.fromisoformat(row["date"])
        amount = float(row["money"])
        if row["datetime"][:10] != row["date"] or not math.isfinite(amount) or amount <= 0:
            raise ValueError("Invalid source timestamp or sale amount")
        name = row["coffee_name"].strip()
        if not name:
            raise ValueError("Missing beverage name")
        counts[(day, name)] += 1
        active.add(day)
        first[name] = min(first.get(name, day), day)
    if not rows:
        raise ValueError("Empty dataset")
    # Zero records for an introduced drink on a machine-active day are counted
    # as zero recorded transactions, not proof of stock/menu availability.
    series = {name: {day: float(counts[(day, name)]) for day in sorted(active) if day >= since}
              for name, since in sorted(first.items())}
    start, end = min(active), max(active)
    missing = [(start + timedelta(days=i)).isoformat() for i in range((end - start).days + 1)
               if start + timedelta(days=i) not in active]
    return series, {"source_url": SOURCE_URL, "dataset_ref": DATASET, "archive_sha256": sha(Path(archive).read_bytes()),
                    "source_csv": MEMBER, "source_csv_sha256": sha(raw), "ignored_members": ignored,
                    "raw_rows": len(rows), "products": len(series), "first_date": start.isoformat(),
                    "last_date": end.isoformat(), "machine_active_days": len(active), "unknown_days": missing,
                    "target": "recorded beverage transactions per product per source-calendar day",
                    "zero_policy": "No records after product introduction on a machine-active day => zero transactions; full missing days remain unknown.",
                    "quantity_limitation": "No quantity column; one record is one recorded vend event, not independently verified cups.",
                    "price_policy": "Money/currency and customer identifiers are excluded from all features."}


def window(series, origin, days=28):
    histories, actual = [], []
    for observations in series.values():
        before = [origin - timedelta(days=i) for i in range(27, -1, -1)]
        after = [origin + timedelta(days=i) for i in range(1, days + 1)]
        if any(day not in observations for day in before + after):
            raise ValueError("Evaluation needs complete prior and future calendar windows")
        histories.append([observations[day] for day in before])
        actual.append([observations[day] for day in after])
    return histories, actual


def splits(series):
    end = min(max(observations) for observations in series.values())
    test_origin = end - timedelta(days=28)
    window(series, test_origin)
    # Latest *fully observed* validation block strictly before the holdout.
    origin = test_origin - timedelta(days=28)
    earliest = max(min(observations) for observations in series.values()) + timedelta(days=60)
    while origin >= earliest:
        try:
            window(series, origin)
            return origin, test_origin, end
        except ValueError:
            origin -= timedelta(days=1)
    raise ValueError("No complete validation block before the final holdout")


def baseline(histories, days, method):
    result = []
    for original in histories:
        values = original.copy()
        predictions = []
        for _ in range(days):
            prediction = values[-7] if method == "weekly-naive" else float(np.mean(values[-28:]))
            predictions.append(prediction)
            values.append(prediction)
        result.append(predictions)
    return result


def metrics(actual, predicted):
    actual, predicted = np.array(actual), np.array(predicted)
    error = actual - predicted
    return {"mae": float(np.mean(np.abs(error))), "rmse": float(np.sqrt(np.mean(error ** 2))),
            "wape_percent": float(np.sum(np.abs(error)) / actual.sum() * 100) if actual.sum() else None,
            "actual_total": float(actual.sum()), "predicted_total": float(predicted.sum()), "pairs": int(actual.size)}


def read_prepared(path, provenance):
    raw = path.read_bytes()
    if sha(raw) != provenance["prepared_csv_sha256"]:
        raise ValueError("Prepared data checksum mismatch")
    series = {}
    for row in csv.DictReader(io.StringIO(raw.decode("utf-8"))):
        if set(row) != {"date", "product", "transactions"}:
            raise ValueError("Unexpected prepared dataset schema")
        day, name, quantity = date.fromisoformat(row["date"]), row["product"], int(row["transactions"])
        if not name or quantity < 0 or day in series.get(name, {}):
            raise ValueError("Invalid or duplicate prepared observation")
        series.setdefault(name, {})[day] = float(quantity)
    if len(series) != provenance["products"] or sum(sum(v.values()) for v in series.values()) != provenance["raw_rows"]:
        raise ValueError("Prepared data does not conserve source transactions")
    return dict(sorted(series.items()))


def evaluate(series):
    validation_origin, test_origin, end = splits(series)
    histories, actual = window(series, validation_origin)
    objectives = {"relative-poisson": "count:poisson", "relative-absolute": "reg:absoluteerror"}
    validation = {method: metrics(actual, baseline(histories, 28, method)) for method in ("weekly-naive", "rolling-mean-28")}
    for name, objective in objectives.items():
        estimator = fit(series, validation_origin, objective)
        validation[name] = metrics(actual, forecast(estimator, histories, validation_origin, 28))
    # Choose before touching the final holdout; do not search on test outcomes.
    chosen_model = min(objectives, key=lambda name: validation[name]["mae"])
    chosen_baseline = min(("weekly-naive", "rolling-mean-28"), key=lambda name: validation[name]["mae"])
    estimator = fit(series, test_origin, objectives[chosen_model])
    histories, actual = window(series, test_origin)
    predictions = forecast(estimator, histories, test_origin, 28)
    holdout = {method: metrics(actual, baseline(histories, 28, method)) for method in ("weekly-naive", "rolling-mean-28")}
    holdout[chosen_model] = metrics(actual, predictions)
    report = {"validation_origin": validation_origin.isoformat(),
              "validation_from": (validation_origin + timedelta(days=1)).isoformat(),
              "validation_to": (validation_origin + timedelta(days=28)).isoformat(),
              "holdout_origin": test_origin.isoformat(), "holdout_from": (test_origin + timedelta(days=1)).isoformat(),
              "holdout_to": end.isoformat(), "chosen_model_from_validation": chosen_model,
              "chosen_baseline_from_validation": chosen_baseline, "validation": validation, "holdout": holdout,
              "beats_selected_baseline_on_holdout": holdout[chosen_model]["mae"] < holdout[chosen_baseline]["mae"],
              "per_product_holdout": {name: metrics([real], [pred]) for name, real, pred in zip(series, actual, predictions)},
              "evaluation_note": "Model and baseline chosen on validation only; final holdout evaluated once without tuning. External-machine results do not measure this shop's accuracy."}
    return fit(series, end, objectives[chosen_model]), report, estimator


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=Path(".local/datasets/coffee-sales/original.zip"))
    parser.add_argument("--output", type=Path, default=Path(".local/coffee-sales-training"))
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--prepared", type=Path, help="Offline replay from the committed de-identified daily CSV")
    parser.add_argument("--provenance", type=Path, default=Path(__file__).parent / "evaluations/coffee-sales/provenance.json")
    args = parser.parse_args()
    if args.prepared:
        if args.download:
            parser.error("--prepared and --download cannot be combined")
        provenance = json.loads(args.provenance.read_text(encoding="utf-8"))
        if provenance["license"] != "CC0: Public Domain" or provenance["dataset_ref"] != DATASET:
            raise ValueError("Unexpected prepared-data source/license")
        series = read_prepared(args.prepared, provenance)
    else:
        # License comes from the original publisher, not only a third-party mirror.
        metadata_url = "https://www.kaggle.com/api/v1/datasets/list?search=coffee%20sales&user=ihelon"
        with urlopen(metadata_url, timeout=30) as response:
            metadata = next(item for item in json.load(response) if item["ref"] == DATASET)
        if metadata["licenseName"] != "CC0: Public Domain":
            raise ValueError("Original dataset license changed; review before reuse")
        if args.download:
            args.archive.parent.mkdir(parents=True, exist_ok=True)
            with urlopen(DOWNLOAD_URL, timeout=60) as response:
                args.archive.write_bytes(response.read(10_000_001))
        series, provenance = prepare(args.archive)
        provenance.update(license=metadata["licenseName"], publisher_last_updated=metadata["lastUpdated"], license_metadata_url=metadata_url)
    estimator, report, evaluated_estimator = evaluate(series)
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / "daily.csv").open("w", newline="", encoding="utf-8") as output:
        writer = csv.writer(output, lineterminator="\n")
        writer.writerow(["date", "product", "transactions"])
        for name, observations in series.items():
            for day, quantity in observations.items():
                writer.writerow([day.isoformat(), name, int(quantity)])
    provenance["prepared_csv_sha256"] = sha((args.output / "daily.csv").read_bytes())
    model_data = estimator.save_raw(raw_format="json")
    (args.output / "model.json").write_bytes(model_data)
    holdout_model_data = evaluated_estimator.save_raw(raw_format="json")
    (args.output / "holdout-model.json").write_bytes(holdout_model_data)
    manifest = {"model_version": "external-coffee-xgb-" + sha(model_data)[:12], "model_sha256": sha(model_data),
                "holdout_model_sha256": sha(holdout_model_data),
                "features": FEATURES, "representation": "prior-28-day-relative-demand", "xgboost_version": xgboost.__version__,
                "training_environment": {"system": platform.system(), "machine": platform.machine(),
                                         "python": platform.python_version(), "numpy": np.__version__},
                "training_through": provenance["last_date"], "provenance": provenance, "evaluation": report,
                "deployment_approved": False,
                "deployment_policy": "Offline evaluation only. Not loaded by the app. No promotion after losing to the validation-selected baseline on holdout.",
                "interval_kind": "unavailable"}
    for name, value in [("manifest.json", manifest), ("evaluation.json", report), ("provenance.json", provenance)]:
        (args.output / name).write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"model_version": manifest["model_version"], "source": provenance,
                      "chosen_model": report["chosen_model_from_validation"], "holdout": report["holdout"],
                      "beats_selected_baseline": report["beats_selected_baseline_on_holdout"]}, indent=2))


if __name__ == "__main__":
    main()
