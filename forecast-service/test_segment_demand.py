from datetime import date, timedelta
import unittest

from evaluate_research import scores
from segment_demand import classify, select_earlier, weighted_metrics


class DemandSegmentTests(unittest.TestCase):
    def rows(self,positive,qty=2,n=40):
        return [dict(date=(date(2025,1,1)+timedelta(days=i)).isoformat(),qty=qty if i<positive else 0) for i in range(n)]

    def test_fixed_frequency_and_volume_rules(self):
        for positive,qty,expected in [(32,3,'Fast-moving'),(28,2,'Medium-moving'),(16,2,'Slow-moving'),(8,1,'Very sparse')]:
            result=classify(self.rows(positive,qty),'2025-02-09')
            self.assertEqual(result['segment'],expected)
            self.assertEqual(result['positive_periods'],positive)
            self.assertEqual(result['total'],positive*qty)

    def test_future_and_old_rows_do_not_change_group(self):
        rows=self.rows(28);before=classify(rows,'2025-02-09')
        rows += [dict(date='2025-02-10',qty=99999),dict(date='2024-01-01',qty=99999)]
        self.assertEqual(before,classify(rows,'2025-02-09'))

    def test_quality_and_missing_periods_not_zero_filled(self):
        rows=self.rows(40)
        rows[0]['stockout']=True;rows[1]['is_complete_day']=False;rows[2]['quality']='incomplete'
        rows[3]['business_day_complete']=False;rows[4]['quality']='missing'
        result=classify(rows,'2025-02-09')
        self.assertEqual(result['observations'],35)
        self.assertEqual(result['zero_percent'],0)
        self.assertEqual(classify(rows[:20],'2025-02-09')['segment'],'Insufficient history')

    def test_selector_only_uses_fully_elapsed_folds(self):
        methods=['weekday-mean-v1','other'];completed=[]
        for cutoff in ['2025-01-01','2025-01-02','2025-01-03']:
            rows={m:[dict(cutoff=cutoff,date=cutoff,actual=2,predicted=2 if m=='other' else 3,segment='Slow-moving') for _ in range(8)] for m in methods}
            completed.append(dict(end=cutoff,rows=rows))
        self.assertEqual(select_earlier(completed,'Slow-moving','2025-01-04',methods),'other')
        future={m:[dict(cutoff='2025-01-04',date='2025-01-05',actual=99999,predicted=99999 if m=='weekday-mean-v1' else 0,segment='Slow-moving') for _ in range(100)] for m in methods}
        completed.append(dict(end='2025-01-05',rows=future))
        self.assertEqual(select_earlier(completed,'Slow-moving','2025-01-04',methods),'other')
        self.assertEqual(select_earlier(completed,'Slow-moving','2025-01-02',methods),'weekday-mean-v1')

    def test_pooled_wape_weights_volume_and_counts_zero_actual_errors(self):
        rows=[dict(cutoff='x',date='x',product_id='a',actual=100,predicted=110),
              dict(cutoff='x',date='x',product_id='b',actual=1,predicted=3),
              dict(cutoff='x',date='x',product_id='c',actual=0,predicted=2)]
        result=scores(rows)['product_day']
        self.assertAlmostEqual(result['wape'],100*14/101)
        self.assertEqual(result['samples'],3)
        weighted=weighted_metrics(rows)
        self.assertAlmostEqual(weighted['mae'],1002/101)
        self.assertAlmostEqual(weighted['rmse'],(10004/101)**.5)
        self.assertAlmostEqual(weighted['bias'],1002/101)


if __name__=='__main__':unittest.main()
