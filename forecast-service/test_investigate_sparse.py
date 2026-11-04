from datetime import date,timedelta
import csv
import io
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
import zipfile

from evaluate_research import predictions
from investigate_sparse import experiment_predictions,audit_data
from test_engine import observations

class SparseInvestigationTests(unittest.TestCase):
    def test_experiment_preserves_reference_history_and_ignores_future(self):
        data=dict(daily=[dict(r,outlet_id='s') for r in observations(100)],products=[dict(id='a',name='Coffee')])
        old=predictions(data,'s','2026-11-02',7)
        with patch('investigate_sparse.global_onehot',return_value={'a':[1.]*7}):
            first=experiment_predictions(data,'s','2026-11-02',7,old)
            data['daily'].append(dict(date='2026-11-02',product_id='a',qty=99999,outlet_id='s'))
            self.assertEqual(first,experiment_predictions(data,'s','2026-11-02',7,old))
            data['daily'][0]['qty']+=1
            with self.assertRaisesRegex(ValueError,'Training input differs'):
                experiment_predictions(data,'s','2026-11-02',7,old)
        self.assertTrue(all(len(rows)==7 for rows in first['predictions'].values()))

    def test_raw_reconciliation_and_missing_day_audit(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'raw.zip';out=io.StringIO()
            writer=csv.writer(out);writer.writerow(['date','datetime','coffee_name'])
            writer.writerows([['2025-01-01','2025-01-01 09:00','Coffee'],['2025-01-03','2025-01-03 09:00','Coffee']])
            with zipfile.ZipFile(path,'w') as source:source.writestr('index_1.csv',out.getvalue())
            data=dict(products=[dict(id='a',name='Coffee')],daily=[dict(date=d,product_id='a',qty=1,outlet_id='index_1') for d in ['2025-01-01','2025-01-03']])
            result=audit_data(data,path,'2025-01-03')
            self.assertEqual(result['missing_dates'],['2025-01-02'])
            self.assertEqual(result['verified_full_day_zero_sales_dates'],0)
            data['daily'].append(dict(date='2025-01-02',product_id='a',qty=0,outlet_id='index_1'))
            with self.assertRaisesRegex(ValueError,'Missing dates were filled'):audit_data(data,path,'2025-01-03')
