import unittest
import numpy as np
from selection import baseline, STATISTICAL_METHODS


class StatisticalTests(unittest.TestCase):
    def test_constant_and_zero_history_preserve_demand_for_every_statistical_method(self):
        for method in STATISTICAL_METHODS:
            for value in [0.0, 12.0]:
                np.testing.assert_allclose(baseline([value] * 84, 30, method), [value] * 30)

    def test_simple_smoothing_weights_new_observations(self):
        np.testing.assert_allclose(baseline([10.0, 20.0], 3, "ses-v1"), [12.0] * 3)

    def test_damped_trend_increments_shrink_and_never_go_negative(self):
        forecast = baseline(list(range(1, 85)), 30, "damped-holt-v1")
        increments = np.diff(forecast)
        self.assertTrue(np.all(increments > 0))
        np.testing.assert_allclose(increments[1:] / increments[:-1], .9)
        self.assertTrue(all(v >= 0 for v in baseline(list(range(84, 0, -1)), 30, "damped-holt-v1")))

    def test_weekday_mean_aligns_the_next_weekday(self):
        self.assertEqual(baseline([1,2,3,4,5,6,7]*4, 8, "weekday-mean-v1"), [1,2,3,4,5,6,7,1])
