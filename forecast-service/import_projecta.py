"""One-time export of the user-supplied, trusted ProjectA v4 artifact.

Run with ProjectA's Python environment. Runtime never unpickles model files.
"""
import argparse
import hashlib
import json
from pathlib import Path

FEATURES = ["lag_1", "lag_7", "lag_14", "lag_28", "mean_7", "mean_28", "weekday", "month", "unit_price"]


def export(source: Path, destination: Path):
    import joblib
    import numpy as np
    import pandas as pd
    import xgboost

    artifact = joblib.load(source)
    if artifact.get("version") != 4 or any(artifact["methods"].get(h) != "xgboost" for h in (7, 14, 28)):
        raise ValueError("This adapter requires a ProjectA v4 artifact selecting XGBoost for 7/14/28 days")
    model = artifact["model"]
    if model.get_booster().feature_names != FEATURES:
        raise ValueError("ProjectA feature schema does not match the adapter")
    destination.mkdir(parents=True, exist_ok=True)
    model_path = destination / "model.json"
    model.save_model(model_path)
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    manifest = {
        "model_version": "projecta-xgb-" + digest[:12],
        "model_sha256": digest,
        "source_artifact": source.name,
        "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "source_format_version": 4,
        "xgboost_version": xgboost.__version__,
        "features": FEATURES,
        "selected_methods": artifact["methods"],
        "validated_horizons": [7, 14, 28],
        "interval_kind": "unavailable",
        "training_domain": "ProjectA retail; coffee-shop accuracy has not been validated",
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    # Synthetic parity fixtures from the original estimator, including recursive
    # feedback and the original per-series price convention; no customer data.
    cases = []
    for price, history in [(65.0, [float(8 + (i * 7) % 13) for i in range(28)]), (0.0, [0.0] * 28)]:
        initial = history.copy()
        expected = []
        for offset in range(1, 31):
            day = pd.Timestamp("2026-10-31") + pd.Timedelta(days=offset)
            row = [history[-1], history[-7], history[-14], history[-28], float(np.mean(history[-7:])),
                   float(np.mean(history[-28:])), day.dayofweek, day.month, price]
            quantity = max(0.0, float(model.predict(pd.DataFrame([row], columns=FEATURES))[0]))
            expected.append(quantity)
            history.append(quantity)
        cases.append({"origin": "2026-10-31", "unit_price": price, "history": initial, "expected": expected})
    (destination / "parity.json").write_text(json.dumps(cases, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"model_version": manifest["model_version"], "source_artifact": source.name}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--destination", type=Path, default=Path(__file__).parent / "artifacts")
    args = parser.parse_args()
    export(args.source, args.destination)
