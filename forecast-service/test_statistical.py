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

class HorizonSelectionTests(unittest.TestCase):
    def test_nonoverlapping_origins_and_history_thresholds_match_each_horizon(self):
        import json
        from unittest.mock import patch
        from selection import choose
        for horizon, minimum, origins in [(1,42,14),(7,56,4),(30,88,2)]:
            for length in [minimum-1, minimum]:
                snapshot = json.dumps(dict(origin='2026-11-02',horizon=horizon,
                    histories=[[10.0]*length],price_histories=[[65.0]*length],
                    product_ids=['p1'],sources=[['actual']]),sort_keys=True)
                with patch('selection.persist'):
                    choose.cache_clear()
                    selected, _, scores = choose(snapshot)
                self.assertEqual(selected,['weekly-naive-v1'])
                if length < minimum:
                    self.assertEqual(scores,[])
                else:
                    self.assertEqual(scores[0]['validation_days'],horizon)
                    self.assertEqual(scores[0]['origins'],origins)
                    self.assertEqual(scores[0]['evaluation_kind'],'rolling_validation_nonoverlapping')
                    self.assertTrue(all(m['samples']==horizon*origins for m in scores[0]['selection_metrics'].values()))

class LaggedOriginTests(unittest.TestCase):
    def test_validation_bridges_unobserved_days_before_scoring_the_requested_targets(self):
        import json
        from unittest.mock import patch
        from selection import choose
        snapshot=json.dumps(dict(origin='2026-11-02',horizon=7,gap_days=2,
            histories=[[float(i%7+1) for i in range(84)]],price_histories=[[65.0]*84],
            product_ids=['p1'],sources=[['actual']]),sort_keys=True)
        with patch('selection.persist'):
            choose.cache_clear()
            selected, _, scores=choose(snapshot)
        self.assertEqual(selected,['weekly-naive-v1'])
        self.assertEqual(scores[0]['gap_days'],2)
        self.assertEqual(scores[0]['selection_metrics']['weekly-naive-v1']['mae'],0)
        self.assertEqual(scores[0]['selection_metrics']['weekly-naive-v1']['samples'],28)
