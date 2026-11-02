import json
from datetime import date, timedelta
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from fastapi import HTTPException
from pydantic import ValidationError

from app import ForecastRequest, forecast, health
from model import ARTIFACTS, MODEL_VERSION, InsufficientHistory, predict, recursive_forecast
from selection import choose


def observations(values, product="p1", price=65.0, end=date(2026, 11, 2)):
    return [dict(date=(end - timedelta(days=len(values) - 1 - i)).isoformat(),
                 product_id=product, qty=float(qty), unit_price=price, source="demo")
            for i, qty in enumerate(values)]


class ForecastTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.patch = patch("selection.RUNTIME", __import__("pathlib").Path(self.directory.name))
        self.patch.start()
        choose.cache_clear()

    def tearDown(self):
        choose.cache_clear()
        self.patch.stop()
        self.directory.cleanup()

    def test_native_model_matches_original_projecta_recursive_predictions(self):
        cases = json.loads((ARTIFACTS / "parity.json").read_text())
        for case in cases:
            actual = recursive_forecast([case["history"]], [case["unit_price"]], date.fromisoformat(case["origin"]), 30)[0]
            np.testing.assert_allclose(actual, case["expected"], atol=1e-6, rtol=0)

    def test_batch_prediction_keeps_products_independent(self):
        cases = json.loads((ARTIFACTS / "parity.json").read_text())
        batch = recursive_forecast([c["history"] for c in cases], [c["unit_price"] for c in cases], date(2026, 10, 31), 30)
        for actual, case in zip(batch, cases):
            np.testing.assert_allclose(actual, case["expected"], atol=1e-6, rtol=0)

    def test_missing_history_is_actionable_instead_of_a_fake_zero_forecast(self):
        with self.assertRaises(InsufficientHistory):
            predict("2026-11-03", "2026-11-04", ["p1"], [])

    def test_explicit_zero_sales_are_valid_and_have_no_invented_interval(self):
        result = predict("2026-11-03", "2026-11-04", ["p1"], observations([0] * 28))
        self.assertEqual(len(result), 2)
        self.assertTrue(all(r["predicted_qty"] == 0 and r["lower"] is None and r["upper"] is None for r in result))
        self.assertEqual(result[0]["model_version"], "weekly-naive-v1")

    def test_future_observations_do_not_leak_into_prediction(self):
        history = observations([10 + i % 7 for i in range(28)])
        original = predict("2026-11-03", "2026-11-09", ["p1"], history)
        history += [dict(date="2026-11-03", product_id="p1", qty=999, unit_price=999, source="actual")]
        self.assertEqual(predict("2026-11-03", "2026-11-09", ["p1"], history), original)

    def test_missing_calendar_day_is_not_silently_zero_filled(self):
        history = observations([10] * 35)
        del history[-5]
        with self.assertRaises(InsufficientHistory):
            predict("2026-11-03", "2026-11-09", ["p1"], history)

    def test_duplicate_observations_are_rejected(self):
        history = observations([10] * 28)
        with self.assertRaises(ValueError):
            predict("2026-11-03", "2026-11-09", ["p1"], history + history[:1])

    def test_forecast_date_gap_is_recursed_without_shifting_the_prediction(self):
        history = observations([10 + i % 7 for i in range(28)])
        whole = predict("2026-11-03", "2026-11-10", ["p1"], history)
        later = predict("2026-11-04", "2026-11-10", ["p1"], history)
        self.assertEqual(later, whole[1:])

    def test_stale_history_and_incomplete_product_batches_fail(self):
        for products, end in [(["p1", "p2"], date(2026, 11, 2)), (["p1"], date(2026, 10, 20))]:
            with self.assertRaises(InsufficientHistory):
                predict("2026-11-03", "2026-11-09", products, observations([10] * 28, end=end))

    def test_periodic_coffee_sales_choose_exact_weekly_method_over_transferred_retail_model(self):
        history = observations([float(10 + i % 7) for i in range(84)])
        result = predict("2026-11-03", "2026-11-30", ["p1"], history)
        self.assertTrue(all(row["model_version"] == "weekly-naive-v1" for row in result))
        self.assertEqual([r["predicted_qty"] for r in result], [float(10 + i % 7) for i in range(28)])

    def test_local_xgboost_is_trained_and_considered_without_claiming_test_accuracy(self):
        history = observations([15.0] * 85 + [60, 0, 60, 0, 60, 0, 60] + [15.0] * 28)
        result = predict("2026-11-03", "2026-11-09", ["p1"], history)
        versions = {row["model_version"] for row in result}
        self.assertTrue(all(v.startswith(("coffee-xgb-", "projecta-xgb-", "weekly-naive-v1")) for v in versions))
        self.assertTrue(all(row["predicted_qty"] >= 0 for row in result))
        # This reproducible series favors a learned average over copying noise.
        self.assertTrue(any(v.startswith("coffee-xgb-") for v in versions))
        from pathlib import Path
        metadata = json.loads(next(Path(self.directory.name).glob("*.metadata.json")).read_text())
        self.assertEqual(metadata["history_sources"], [["demo"]])
        self.assertIn("not an independent", metadata["evaluation_note"])
        self.assertIn(MODEL_VERSION, metadata["selection"][0]["selection_mae"])

    def test_api_requires_price_and_source_and_rejects_nonfinite_sales(self):
        payload = dict(date_from="2026-11-03", date_to="2026-11-09", product_ids=["00000000-0000-4000-8000-000000000001"], history=[])
        for sale in [dict(date="2026-11-02", product_id=payload["product_ids"][0], qty=10),
                     dict(date="2026-11-02", product_id=payload["product_ids"][0], qty=float("nan"), unit_price=65, source="actual")]:
            with self.assertRaises(ValidationError):
                ForecastRequest.model_validate({**payload, "history": [sale]})
        with self.assertRaises(HTTPException) as error:
            forecast(ForecastRequest.model_validate(payload))
        self.assertEqual(error.exception.detail["code"], "FORECAST_INSUFFICIENT_HISTORY")
        self.assertEqual(health()["mode"], "adaptive")

    def test_selection_never_uses_prices_from_the_validation_window(self):
        base = dict(origin="2026-11-02", histories=[[15.0] * 84], product_ids=["p1"], sources=[["demo"]])
        scores = []
        for price in [65.0, 999.0]:
            snapshot = json.dumps({**base, "price_histories": [[65.0] * 56 + [price] * 28]}, sort_keys=True)
            errors = choose(snapshot)[2][0]["selection_mae"]
            scores.append({"local" if k.startswith("coffee-xgb-") else k:v for k,v in errors.items()})
        self.assertEqual(scores[0], scores[1])

    def test_rejects_long_or_reversed_range(self):
        for end in ["2027-01-01", "2026-11-02"]:
            with self.assertRaises(ValueError):
                predict("2026-11-03", end, ["p1"], [])


if __name__ == "__main__":
    unittest.main()
