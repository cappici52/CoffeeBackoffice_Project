import tempfile
import unittest
from pathlib import Path
import test_external
from coffee_sales_dataset import normalize

class CoffeeReplayAdapterTests(unittest.TestCase):
    def test_adapter_reuses_parser_separates_streams_and_preserves_unknown_days(self):
        factory=test_external.ExternalCoffeeTests()
        with tempfile.TemporaryDirectory() as directory:
            archive=factory.archive(directory,[factory.row('2024-03-01'),factory.row('2024-03-03','Americano')])
            # The older test's second member is deliberately not a valid CSV.
            import zipfile,csv,io
            with zipfile.ZipFile(archive) as old:
                raw=old.read('index_1.csv')
            with zipfile.ZipFile(archive,'w') as out:out.writestr('index_1.csv',raw)
            result=normalize(archive,dict(licenseName='CC0: Public Domain',currentVersionNumber=21))
        self.assertEqual(result['report']['item_occurrences'],2)
        self.assertEqual(result['outlets'][0]['missing_dates'],['2024-03-02'])
        self.assertEqual(sum(r['qty'] for r in result['daily']),2)
        self.assertTrue(any(r['quality']=='inferred_zero' for r in result['daily']))
        self.assertNotIn('ANON-example-unused',str(result))
        self.assertEqual(result['data_mode'],'PUBLIC_DATASET')

    def test_changed_license_is_not_accepted(self):
        with self.assertRaises(ValueError):normalize(Path('unused'),dict(licenseName='unknown',currentVersionNumber=21))
