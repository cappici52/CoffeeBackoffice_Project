import unittest
from datetime import date
from unittest.mock import patch
from evaluate_research import schedule,scores,predictions
from test_engine import observations

class RollingResearchTests(unittest.TestCase):
    def test_schedule_is_chronological_disjoint_and_never_exceeds_final_date(self):
        for h,n in [(1,90),(7,12),(30,3)]:
            cutoffs=schedule(date(2025,3,23),90,h)
            self.assertEqual(len(cutoffs),n)
            self.assertEqual(cutoffs,sorted(cutoffs))
            self.assertEqual((date.fromisoformat(cutoffs[-1])-date.fromisoformat(cutoffs[0])).days,(n-1)*h)

    def test_missing_truth_excludes_partial_total_days_and_zero_metrics_remain_defined(self):
        result=scores([dict(cutoff='a',date='b',actual=0,predicted=2),dict(cutoff='a',date='b',actual=None,predicted=3)])
        self.assertEqual(result['product_day']['mae'],2)
        self.assertIsNone(result['product_day']['wape'])
        self.assertEqual(result['daily_total']['samples'],0)

    def test_every_candidate_ignores_target_and_later_quantities(self):
        rows=[dict(r,outlet_id='s') for r in observations(100)]
        data=dict(daily=rows)
        with patch('engine.fit',return_value=None):
            first=predictions(data,'s','2026-11-02',7)
            data['daily']+= [dict(date='2026-11-02',product_id='a',qty=999999,unit_price=999999,outlet_id='s')]
            self.assertEqual(first,predictions(data,'s','2026-11-02',7))
        self.assertEqual(first['training_to'],'2026-11-01')
        self.assertNotIn('direct',first['predictions'])

    def test_xgboost_candidate_also_has_no_target_input(self):
        rows=[dict(r,outlet_id='s') for r in observations(100)]
        data=dict(daily=rows)
        first=predictions(data,'s','2026-11-02',7)
        data['daily']+=[dict(date='2026-11-02',product_id='a',qty=999999,outlet_id='s')]
        self.assertEqual(first,predictions(data,'s','2026-11-02',7))
        self.assertIn('direct',first['predictions'])
