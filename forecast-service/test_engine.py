from datetime import date, timedelta
import unittest
from unittest.mock import patch

from engine import predict, run, features
from forecast_errors import InsufficientHistory


def observations(days=180, product='a'):
    return [dict(date=(date(2026,11,1)-timedelta(days=days-i-1)).isoformat(),product_id=product,
                 qty=float(10+i%7),unit_price=65.,source='actual') for i in range(days)]


class DemandEngineTests(unittest.TestCase):
    def setUp(self):
        run.cache_clear()

    def test_missing_and_stockout_dates_are_not_replaced_with_zeroes(self):
        rows=observations(60)
        rows.pop(-5)
        with patch('engine.fit',return_value=None):
            result=predict('2026-11-04','2026-11-10',['a'],rows)
        self.assertEqual(len(result),7)
        self.assertTrue(all(r['predicted_qty']>0 for r in result))
        self.assertEqual(result[0]['diagnostics']['history_days'],59)

    def test_unknown_lags_are_missing_values_and_future_values_do_not_enter_features(self):
        series={date(2026,11,1):dict(qty=12,unit_price=65),date(2026,11,4):dict(qty=9999,unit_price=9999)}
        import math
        x=features(series,0,date(2026,11,1),date(2026,11,4))
        self.assertEqual(x[1],12)
        self.assertTrue(math.isnan(x[2]))
        self.assertEqual(x[-1],65)

    def test_calibration_targets_are_strictly_after_selection_targets(self):
        with patch('engine.fit',return_value=None):
            rows=predict('2026-11-04','2026-12-03',['a'],observations())
        first=rows[0]
        self.assertEqual(first['diagnostics']['validation_origins'],2)
        self.assertEqual(first['diagnostics']['calibration']['samples'],30)
        self.assertEqual(first['diagnostics']['calibration']['date_to'],'2026-11-01')
        self.assertTrue(first['lower']<=first['predicted_qty']<=first['upper'])
        self.assertEqual(first['diagnostics']['interval_kind'],'empirical_absolute_80')

    def test_future_targets_cannot_influence_selection_or_interval_width(self):
        base=observations()
        with patch('engine.fit',return_value=None):
            first=predict('2026-11-04','2026-11-10',['a'],base)
            extra=base+[dict(date='2026-11-04',product_id='a',qty=9999.,unit_price=9999.,source='actual')]
            self.assertEqual(first,predict('2026-11-04','2026-11-10',['a'],extra))

    def test_short_history_is_explicit_and_does_not_invent_an_interval(self):
        result=predict('2026-11-04','2026-11-04',['a'],observations(28))
        self.assertIsNone(result[0]['lower'])
        self.assertEqual(result[0]['diagnostics']['validation_origins'],0)
        for count in [1,7,27]:
            result=predict('2026-11-04','2026-11-04',['a'],observations(count))
            self.assertIsNone(result[0]['lower'])
            self.assertEqual(result[0]['model_version'],'mean-7-v1')
            self.assertEqual(result[0]['diagnostics']['reason'],'limited_history_mean')
        with self.assertRaises(InsufficientHistory):
            predict('2026-11-04','2026-11-04',['a'],[])

    def test_direct_candidate_is_trained_from_shop_quantities_without_legacy_retail_predictions(self):
        result=predict('2026-11-04','2026-12-03',['a'],observations(120))
        candidates=result[0]['diagnostics']['selection']
        self.assertIn('direct',candidates)
        self.assertFalse(any('projecta' in key for key in candidates))

    def test_constant_and_explicit_zero_sales_keep_weekly_tie_break(self):
        with patch('engine.fit',return_value=None):
            for value in [0.,12.]:
                rows=observations()
                for r in rows:r['qty']=value
                result=predict('2026-11-04','2026-11-10',['a'],rows)
                self.assertTrue(all(r['predicted_qty']==value and r['model_version']=='weekly-naive-v1' for r in result))

class DeclaredPolicyTests(unittest.TestCase):
    def test_baseline_policy_is_explicit_and_does_not_train_a_model(self):
        with patch('engine.fit') as fit:
            result=predict('2026-11-04','2026-11-10',['a'],observations(),policy='mean28')
        fit.assert_not_called()
        self.assertTrue(all(r['model_version']=='mean-28-v1' for r in result))
        self.assertEqual(result[0]['diagnostics']['method_policy'],'mean28')
        self.assertEqual(result[0]['diagnostics']['pipeline'],'coffee-demand-v5-mean28')
        self.assertIsNotNone(result[0]['lower'])

class StandaloneServiceTests(unittest.TestCase):
    def test_new_service_loads_without_legacy_model_or_artifact_files(self):
        import shutil,subprocess,sys,tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as directory:
            for name in ['app.py','engine.py','forecast_errors.py']:
                shutil.copyfile(Path(__file__).parent/name,Path(directory)/name)
            result=subprocess.run([sys.executable,'-c','import app; print(app.health()["model_version"])'],cwd=directory,capture_output=True,text=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(result.stdout.strip(),'coffee-demand-v5')

class SpecificationFeatureTests(unittest.TestCase):
    def test_all_requested_features_use_only_observations_at_or_before_issue_time(self):
        from engine import FEATURES,features,metrics
        origin=date(2026,11,1)
        series={origin-timedelta(days=i):dict(qty=float(40-i),unit_price=65.) for i in range(30)}
        series[origin+timedelta(days=1)]=dict(qty=999999.,unit_price=999999.)
        values=dict(zip(FEATURES,features(series,0,origin,origin+timedelta(days=1))))
        self.assertEqual(values['lag_14'],27.)
        self.assertEqual(values['mean_14'],33.5)
        self.assertGreater(values['std_7'],0)
        self.assertEqual(values['price'],65.)
        self.assertEqual(values['day_of_month'],2)
        self.assertEqual(metrics([(2,4),(4,6)])['bias'],2)

    def test_a_new_menu_does_not_disable_validation_for_established_menus(self):
        rows=observations()+observations(3,'b')
        with patch('engine.fit',return_value=None):
            result=predict('2026-11-04','2026-11-10',['a','b'],rows)
        self.assertTrue(any(p['diagnostics']['selection'] for p in result if p['product_id']=='a'))
        self.assertTrue(all(p['diagnostics']['reason']=='limited_history_mean' for p in result if p['product_id']=='b'))
