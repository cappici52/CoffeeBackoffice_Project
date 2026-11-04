import csv
import io
from pathlib import Path
import tempfile
import unittest
import zipfile

from inspect_maven_density import FIELDS, MEMBER, inspect


class MavenDensityTests(unittest.TestCase):
    def test_pipe_quantity_semantics_and_unknown_store_dates(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'source.zip';stream=io.StringIO()
            writer=csv.DictWriter(stream,fieldnames=sorted(FIELDS),delimiter='|');writer.writeheader()
            base=dict(transaction_time='09:00:00',store_id='1',store_location='Demo',unit_price='3',product_category='Coffee',product_type='Espresso',product_detail='Regular')
            writer.writerow(dict(base,transaction_id='1',transaction_date='2025-01-01',transaction_qty='2',product_id='a'))
            writer.writerow(dict(base,transaction_id='2',transaction_date='2025-01-03',transaction_qty='3',product_id='b'))
            with zipfile.ZipFile(path,'w') as archive:archive.writestr(MEMBER,stream.getvalue())
            result=inspect(path)
            self.assertEqual(result['rows'],2);self.assertEqual(result['total_quantity'],5)
            self.assertEqual(result['stores'][0]['missing_dates'],['2025-01-02'])
            self.assertEqual(result['pooled_coffee_product_store_days']['periods'],3)
            self.assertAlmostEqual(result['pooled_coffee_product_store_days']['zero_percent'],100/3)
            self.assertIn('Fictional/synthetic',result['label'])


if __name__=='__main__':unittest.main()
