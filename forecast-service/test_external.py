import csv
from datetime import date, timedelta
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

import numpy as np

from coffee_demand import BUNDLE, features, forecast, load_bundle, training_rows
from train_external import evaluate, prepare, read_prepared, splits


class ExternalCoffeeTests(unittest.TestCase):
    def archive(self, directory, rows):
        columns = ["date", "datetime", "cash_type", "card", "money", "coffee_name"]
        contents = io.StringIO()
        writer = csv.DictWriter(contents, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)
        path = Path(directory) / "source.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("index_1.csv", contents.getvalue())
            archive.writestr("index_2.csv", "different machine/malformed input, do not combine")
        return path

    def row(self, day, product="Latte", time="10:00:00"):
        return {"date": day, "datetime": day + " " + time, "cash_type": "card",
                "card": "ANON-example-unused", "money": "38.7", "coffee_name": product}

    def test_original_source_keeps_machine_members_separate_and_conserves_vends(self):
        with tempfile.TemporaryDirectory() as directory:
            rows = [self.row("2024-03-01"), self.row("2024-03-01", time="11:00:00"),
                    self.row("2024-03-03", "Americano")]
            series, provenance = prepare(self.archive(directory, rows))
        self.assertEqual(sum(sum(values.values()) for values in series.values()), 3)
        self.assertEqual(provenance["ignored_members"], ["index_2.csv"])
        self.assertEqual(series["Latte"][date(2024, 3, 3)], 0)
        self.assertNotIn(date(2024, 3, 1), series["Americano"])
        self.assertNotIn(date(2024, 3, 2), series["Latte"])
        self.assertNotIn("ANON-example-unused", json.dumps(provenance))

    def test_duplicate_transactions_require_review_instead_of_inflating_counts(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "Duplicate"):
                prepare(self.archive(directory, [self.row("2024-03-01")] * 2))

    def test_invalid_timestamps_and_nonfinite_money_are_rejected(self):
        for change in [{"datetime": "2024-03-02 10:00:00"}, {"money": "nan"}, {"money": "-5"}]:
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    prepare(self.archive(directory, [{**self.row("2024-03-01"), **change}]))

    def test_relative_features_transfer_scales_without_currency_or_customer_fields(self):
        values = [float(5 + i % 7) for i in range(28)]
        small, scale = features(values, date(2025, 2, 24))
        large, large_scale = features([v * 10 for v in values], date(2025, 2, 24))
        np.testing.assert_allclose(small, large, atol=1e-12)
        self.assertEqual(large_scale, scale * 10)
        booster, _ = load_bundle()
        predictions = forecast(booster, [values, [v * 10 for v in values]], date(2025, 2, 23), 28)
        np.testing.assert_allclose(predictions[1], np.array(predictions[0]) * 10, atol=1e-4)

    def test_training_excludes_future_targets_and_windows_crossing_unknown_dates(self):
        start = date(2024, 3, 1)
        observations = {start + timedelta(days=i): float(5 + i % 4) for i in range(35)}
        original = training_rows({"Latte": observations}, start + timedelta(days=34))
        self.assertEqual(len(original[1]), 7)
        observations[start + timedelta(days=35)] = 9999
        actual = training_rows({"Latte": observations}, start + timedelta(days=34))
        np.testing.assert_array_equal(original[0], actual[0])
        np.testing.assert_array_equal(original[1], actual[1])
        del observations[start + timedelta(days=15)]
        self.assertEqual(len(training_rows({"Latte": observations}, start + timedelta(days=34))[1]), 0)

    def test_prepared_counts_have_no_customer_fields_and_match_original_provenance(self):
        provenance = json.loads((BUNDLE / "provenance.json").read_text())
        series = read_prepared(BUNDLE / "daily.csv", provenance)
        self.assertEqual(provenance["license"], "CC0: Public Domain")
        self.assertEqual(sum(sum(values.values()) for values in series.values()), 3636)
        self.assertEqual(len(series), 8)
        self.assertEqual((BUNDLE / "daily.csv").read_text().splitlines()[0], "date,product,transactions")
        for missing in provenance["unknown_days"]:
            self.assertTrue(all(date.fromisoformat(missing) not in values for values in series.values()))

    def test_chronological_holdout_is_separate_and_failed_candidate_is_not_promoted(self):
        manifest = json.loads((BUNDLE / "manifest.json").read_text())
        series = read_prepared(BUNDLE / "daily.csv", manifest["provenance"])
        validation_origin, test_origin, end = splits(series)
        self.assertLess(validation_origin + timedelta(days=28), test_origin)
        self.assertEqual(end, date(2025, 3, 23))
        _, replay = evaluate(series)
        saved = manifest["evaluation"]
        self.assertEqual(replay["chosen_model_from_validation"], saved["chosen_model_from_validation"])
        self.assertEqual(replay["chosen_baseline_from_validation"], saved["chosen_baseline_from_validation"])
        self.assertEqual(replay["holdout"]["relative-absolute"]["pairs"], 224)
        self.assertAlmostEqual(replay["holdout"]["relative-absolute"]["wape_percent"], saved["holdout"]["relative-absolute"]["wape_percent"], places=3)
        self.assertFalse(saved["beats_selected_baseline_on_holdout"])
        self.assertFalse(manifest["deployment_approved"])

    def test_modified_model_or_prepared_counts_fail_checksum_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            (directory / "manifest.json").write_bytes((BUNDLE / "manifest.json").read_bytes())
            (directory / "model.json").write_text("{}")
            with self.assertRaisesRegex(RuntimeError, "checksum"):
                load_bundle(directory)
            (directory / "daily.csv").write_text("date,product,transactions\n2025-01-01,Latte,9999\n")
            provenance = json.loads((BUNDLE / "provenance.json").read_text())
            with self.assertRaisesRegex(ValueError, "checksum"):
                read_prepared(directory / "daily.csv", provenance)


if __name__ == "__main__":
    unittest.main()
