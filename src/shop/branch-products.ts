import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { fail, idSchema, money, record } from './shared.js';

export function branchProductsRouter(db:Database,manage:RequestHandler) {
 const r=Router();r.use('/branch-products',manage);
 r.get('/branch-products',async(_req,res)=>res.json({products:(await db.query(`SELECT c.*,p.price_satang AS default_price_satang,p.is_available AS default_is_available,
  o.price_satang AS override_price_satang,o.is_available AS override_is_available,coalesce(o.version,0) AS override_version
  FROM branch_catalog c JOIN products p ON p.id=c.id LEFT JOIN branch_products o ON o.product_id=c.id AND o.branch_id=c.branch_id
  WHERE NOT c.is_archived ORDER BY c.name`)).rows}));
 r.put('/branch-products/:id',async(req,res)=>{
  const id=idSchema.parse(req.params.id),p=z.object({price_satang:money.nullable(),is_available:z.boolean().nullable(),expected_version:z.number().int().min(0)}).strict().parse(req.body);
  await db.transaction(async sql=>{
   fail((await sql.query('SELECT id FROM products WHERE id=$1 AND NOT is_archived',[id])).rows[0],404,'NOT_FOUND');
   const row=(await sql.query(`INSERT INTO branch_products(product_id,price_satang,is_available) SELECT $1,$2,$3 WHERE $4=0
    ON CONFLICT(branch_id,product_id) DO UPDATE SET price_satang=excluded.price_satang,is_available=excluded.is_available,version=branch_products.version+1
    WHERE branch_products.version=$4 RETURNING product_id`,[id,p.price_satang,p.is_available,p.expected_version])).rows[0];
   // Existing overrides need an UPDATE (the INSERT SELECT above deliberately creates only version 0).
   if(!row){
    fail(p.expected_version>0,409,'VERSION_CONFLICT');
    fail((await sql.query('UPDATE branch_products SET price_satang=$1,is_available=$2,version=version+1 WHERE product_id=$3 AND branch_id=coffee_current_branch() AND version=$4 RETURNING product_id',[p.price_satang,p.is_available,id,p.expected_version])).rows[0],409,'VERSION_CONFLICT');
   }
   await record(sql,res.locals.user,'branch.product_updated','product',id,p);
  });res.sendStatus(204);
 });return r;
}
