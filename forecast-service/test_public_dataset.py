import csv
import io
import unittest
from public_dataset import normalize, TRANSACTIONS, PRODUCTS

def raw(columns,rows):
    out=io.StringIO(newline=''); writer=csv.DictWriter(out,fieldnames=sorted(columns));writer.writeheader();writer.writerows(rows)
    return out.getvalue().encode()

def product(id='1',name='Latte'):
    return dict(ProductId=id,ProductName=name,Variant='-',Category='Coffee',Price='20000',Description='Drink')

def sale(day='2025-01-01',items='Latte',qty='1',receipt='1',outlet='A'):
    return dict(Outlet=outlet,Date=day,Time='09:00:00',NetSales='20000',Tax='0',TotalAmount='20000',ReceiptNumber=receipt,Items=items,TotalItem=qty,PaymentMethod='Cash',UseLoyaltyCard='0')

class PublicDatasetTests(unittest.TestCase):
    def test_mapping_aggregation_outlet_zero_and_unknown_days(self):
        result=normalize(raw(TRANSACTIONS,[sale(),sale(receipt='2'),sale('2025-01-03','Tea',receipt='3'),sale('2025-01-03',receipt='4',outlet='B')]),raw(PRODUCTS,[product(),product('2','Tea')]))
        pid=next(p['id'] for p in result['products'] if p['name']=='Latte')
        rows=[r for r in result['daily'] if r['product_id']==pid and r['outlet_id']=='A']
        self.assertEqual([r['qty'] for r in rows],[2,0])
        self.assertEqual(rows[-1]['quality'],'inferred_zero')
        self.assertEqual(result['outlets'][0]['missing_dates'],['2025-01-02'])
        self.assertEqual(result['report']['item_occurrences'],4)

    def test_duplicate_policy_and_idempotent_normalization(self):
        tx=raw(TRANSACTIONS,[sale(),sale()]);p=raw(PRODUCTS,[product()])
        first=normalize(tx,p)
        self.assertEqual(first,normalize(tx,p))
        self.assertEqual(first['report']['exact_duplicates_skipped'],1)
        self.assertEqual(first['report']['item_occurrences'],1)
        with self.assertRaises(ValueError):normalize(raw(TRANSACTIONS,[sale(),sale(items='Tea')]),p)

    def test_bad_schema_nulls_quantity_money_and_unknown_items_fail_closed(self):
        p=raw(PRODUCTS,[product()])
        with self.assertRaises(ValueError):normalize(b'date,qty\n2025-01-01,2',p)
        for changed in [dict(TotalItem='-1'),dict(TotalItem='2'),dict(Items='Unknown'),dict(Outlet=''),dict(NetSales='NaN'),dict(Date='2025-02-30'),dict(TotalAmount='-5')]:
            with self.subTest(changed=changed),self.assertRaises(ValueError):normalize(raw(TRANSACTIONS,[{**sale(),**changed}]),p)
