from datetime import date,timedelta
import unittest
from unittest.mock import patch

import engine
from sparse_candidates import croston,tsb,allocate,past_shares,statistical_predictions,select_from_past,global_onehot

class SparseCandidateTests(unittest.TestCase):
    def series(self,days=120):
        start=date(2025,1,1)
        return {p:engine.Series() for p in ['a','b']},start

    def test_hand_calculated_croston_sba_and_tsb(self):
        values=[0,2,0,0,4]
        self.assertAlmostEqual(croston(values),2.2/2.1)
        self.assertAlmostEqual(croston(values,correct_bias=True),.95*2.2/2.1)
        self.assertAlmostEqual(tsb(values),2.2*(.1+.9*(.5*.9*.9)))
        self.assertEqual(croston([0,0]),0);self.assertEqual(tsb([0,0]),0)
        self.assertEqual(croston([2,0,0]),2)
        self.assertLess(tsb([2,0,0]),tsb([2]))
        with self.assertRaises(ValueError):croston([1,-1])

    def test_top_down_is_coherent_and_uses_only_past_proportions(self):
        series,start=self.series()
        for i in range(40):
            for p,q in [('a',1.),('b',3.)]:series[p][start+timedelta(days=i)]=dict(qty=q,unit_price=0.)
        origin=start+timedelta(days=35);target=origin+timedelta(days=1)
        shares=past_shares(series,['a','b'],origin,target)
        self.assertEqual(shares,{'a':.25,'b':.75})
        allocated=allocate(1.001,shares,['a','b'])
        self.assertAlmostEqual(sum(allocated.values()),1.001)
        first=statistical_predictions(series,['a','b'],origin,[target])
        series['a'][target]['qty']=999999.
        self.assertEqual(first,statistical_predictions(series,['a','b'],origin,[target]))
        for method in ['td-mean28-share28','td-weekday-share28','td-weekday-share-weekday56']:
            self.assertAlmostEqual(sum(first[method][p][0] for p in ['a','b']),4.)

    def test_unknown_dates_are_not_zero_updates(self):
        series,start=self.series()
        for i in [0,2,3]:
            for p in series:series[p][start+timedelta(days=i)]=dict(qty=2. if i==0 else 0.,unit_price=0.)
        result=statistical_predictions(series,['a','b'],start+timedelta(days=3),[start+timedelta(days=4)])
        self.assertAlmostEqual(result['tsb-a10-b10']['a'][0],tsb([2,0,0]))

    def test_selection_and_global_xgb_ignore_later_observations(self):
        series,start=self.series()
        for i in range(120):
            for p,k in [('a',1),('b',2)]:series[p][start+timedelta(days=i)]=dict(qty=float((i*k)%5),unit_price=0.)
        origin=start+timedelta(days=99);targets=[origin+timedelta(days=i) for i in range(1,8)]
        chosen=select_from_past(series,['a','b'],origin,7,0)
        first=global_onehot(series,['a','b'],origin,targets)
        for d in targets:series['a'][d]['qty']=999999.
        self.assertEqual(chosen,select_from_past(series,['a','b'],origin,7,0))
        self.assertEqual(first,global_onehot(series,['a','b'],origin,targets))
        self.assertLess(chosen[1]['selection_end'],targets[0].isoformat())
