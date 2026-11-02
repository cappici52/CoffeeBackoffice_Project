import unittest
from model import predict

class ForecastTests(unittest.TestCase):
    def test_missing_history_is_zero(self):
        result = predict("2026-11-03", "2026-11-04", ["p1"], [])
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["predicted_qty"], 0)
    def test_future_observations_do_not_leak_into_prediction(self):
        history = [dict(date="2026-10-27", product_id="p1", qty=20), dict(date="2026-11-03", product_id="p1", qty=999)]
        result = predict("2026-11-03", "2026-11-03", ["p1"], history)[0]
        self.assertEqual(result["predicted_qty"], 20)
        self.assertLessEqual(result["lower"], result["predicted_qty"])
        self.assertGreaterEqual(result["upper"], result["predicted_qty"])
    def test_rejects_long_range(self):
        with self.assertRaises(ValueError):
            predict("2026-11-03", "2027-01-01", ["p1"], [])

if __name__ == "__main__":
    unittest.main()
