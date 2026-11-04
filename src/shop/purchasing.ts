import { createHash,randomUUID } from 'node:crypto';
import { Router,type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { idSchema,dateSchema,dateRange,quantity,text,note,fail,record,moveStock,businessDate } from './shared.js';

export function purchasingRouter(db:Database,auth:RequestHandler,manage:RequestHandler){
 const r=Router();r.use(['/suppliers','/purchase-orders','/operating-expenses','/inventory-valuation'],auth,manage);
 r.get('/suppliers',async(_req,res)=>res.json({suppliers:(await db.query('SELECT * FROM suppliers ORDER BY is_active DESC,name,id')).rows}));
 const supplier=z.object({name:text,phone:z.string().trim().max(50),lead_time_days:z.number().int().min(0).max(365)}).strict();
 r.post('/suppliers',async(req,res)=>{
  fail(res.locals.user.role==='owner',403,'CENTRAL_MASTER_REQUIRES_OWNER');const p=supplier.parse(req.body),id=randomUUID();
  await db.transaction(async sql=>{await sql.query('INSERT INTO suppliers(id,name,phone,lead_time_days) VALUES($1,$2,$3,$4)',[id,p.name,p.phone,p.lead_time_days]);await record(sql,res.locals.user,'supplier.created','supplier',id,p);});res.status(201).json({id});
 });
 r.patch('/suppliers/:id',async(req,res)=>{
  fail(res.locals.user.role==='owner',403,'CENTRAL_MASTER_REQUIRES_OWNER');const id=idSchema.parse(req.params.id),p=supplier.extend({is_active:z.boolean(),expected_version:z.number().int().positive()}).strict().parse(req.body);
  await db.transaction(async sql=>{fail((await sql.query('UPDATE suppliers SET name=$1,phone=$2,lead_time_days=$3,is_active=$4,version=version+1 WHERE id=$5 AND version=$6 RETURNING id',[p.name,p.phone,p.lead_time_days,p.is_active,id,p.expected_version])).rows[0],409,'VERSION_CONFLICT');await record(sql,res.locals.user,'supplier.updated','supplier',id,p);});res.sendStatus(204);
 });
 r.get('/purchase-orders',async(_req,res)=>res.json({orders:(await db.query('SELECT p.*,s.name AS supplier_name FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id ORDER BY created_at DESC,id DESC LIMIT 100')).rows}));
 r.get('/purchase-orders/:id',async(req,res)=>{const id=idSchema.parse(req.params.id),order=(await db.query('SELECT p.*,s.name AS supplier_name FROM purchase_orders p JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=$1',[id])).rows[0];fail(order,404,'NOT_FOUND');res.json({order,lines:(await db.query('SELECT l.*,i.name,i.unit FROM purchase_order_lines l JOIN ingredients i ON i.id=l.ingredient_id WHERE order_id=$1 ORDER BY i.name',[id])).rows,receipts:(await db.query('SELECT * FROM purchase_receipts WHERE order_id=$1 ORDER BY created_at,id',[id])).rows});});
 r.post('/purchase-orders',async(req,res)=>{
  const p=z.object({supplier_id:idSchema,expected_on:dateSchema,note:note,lines:z.array(z.object({ingredient_id:idSchema,qty:quantity,unit_cost_satang:z.number().min(0).max(1e8)}).strict()).min(1).max(100)}).strict().parse(req.body);fail(p.expected_on>=businessDate(),400,'INVALID_DELIVERY_DATE');fail(new Set(p.lines.map(l=>l.ingredient_id)).size===p.lines.length,400,'DUPLICATE_INGREDIENT');const id=randomUUID();
  await db.transaction(async sql=>{
   const supplier=(await sql.query('SELECT * FROM suppliers WHERE id=$1 AND is_active FOR SHARE',[p.supplier_id])).rows[0];fail(supplier,404,'NOT_FOUND');
   await sql.query('INSERT INTO purchase_orders(id,supplier_id,created_by,expected_on,lead_time_days,note) VALUES($1,$2,$3,$4,$5,$6)',[id,p.supplier_id,res.locals.user.id,p.expected_on,supplier.lead_time_days,p.note]);
   for(const l of p.lines){fail((await sql.query('SELECT id FROM ingredients WHERE id=$1 AND is_active',[l.ingredient_id])).rows[0],404,'NOT_FOUND');await sql.query('INSERT INTO purchase_order_lines(id,order_id,ingredient_id,qty,unit_cost_satang) VALUES($1,$2,$3,$4,$5)',[randomUUID(),id,l.ingredient_id,l.qty,l.unit_cost_satang]);}
   await record(sql,res.locals.user,'purchase.created','purchase_order',id,p);
  });res.status(201).json({id});
 });
 r.post('/purchase-orders/:id/receive',async(req,res)=>{
  const id=idSchema.parse(req.params.id),p=z.object({request_key:idSchema,lines:z.array(z.object({line_id:idSchema,qty:quantity,lot_code:text,expires_on:dateSchema.nullable(),no_expiry:z.boolean().default(false),unit_cost_satang:z.number().min(0).max(1e8)}).strict()).min(1).max(100)}).strict().parse(req.body);
  fail(p.lines.every(l=>!l.no_expiry||l.expires_on===null),400,'INVALID_EXPIRY_STATUS');fail(new Set(p.lines.map(l=>l.line_id)).size===p.lines.length,400,'DUPLICATE_INGREDIENT');const hash=createHash('sha256').update(JSON.stringify({order_id:id,...p,lines:[...p.lines].sort((a,b)=>a.line_id.localeCompare(b.line_id))})).digest('hex');
  const receipt=await db.transaction(async sql=>{
   await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,21))',[p.request_key]);
   const previous=(await sql.query('SELECT id,input_sha256 FROM purchase_receipts WHERE request_key=$1',[p.request_key])).rows[0];if(previous){fail(previous.input_sha256===hash,409,'REQUEST_KEY_CONFLICT');return previous.id;}
   const order=(await sql.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE',[id])).rows[0];fail(order,404,'NOT_FOUND');fail(order.status==='open',409,'PURCHASE_NOT_OPEN');
   const receipt=randomUUID();await sql.query('INSERT INTO purchase_receipts(id,order_id,created_by,request_key,input_sha256) VALUES($1,$2,$3,$4,$5)',[receipt,id,res.locals.user.id,p.request_key,hash]);
   const lines=[];
   for(const row of p.lines){const l=(await sql.query('SELECT * FROM purchase_order_lines WHERE id=$1 AND order_id=$2 FOR UPDATE',[row.line_id,id])).rows[0];fail(l,404,'NOT_FOUND');fail(Number(l.received_qty)+row.qty<=Number(l.qty)+.0000001,409,'RECEIPT_EXCEEDS_ORDER');lines.push({...row,ingredient_id:l.ingredient_id});}
   for(const row of lines.sort((a,b)=>a.ingredient_id.localeCompare(b.ingredient_id))){
    await sql.query('SELECT ingredient_id FROM branch_stock WHERE ingredient_id=$1 AND branch_id=coffee_current_branch() FOR UPDATE',[row.ingredient_id]);
    const lot=randomUUID();await sql.query('INSERT INTO inventory_lots(id,ingredient_id,code,expires_on,unit_cost_satang,expiry_kind) VALUES($1,$2,$3,$4,$5,$6)',[lot,row.ingredient_id,row.lot_code,row.expires_on,row.unit_cost_satang,row.no_expiry?'none':row.expires_on?'dated':'unknown']);
    await moveStock(sql,res.locals.user,row.ingredient_id,'receipt',row.qty,'รับใบสั่งซื้อ '+id,null,null,lot);
    await sql.query('INSERT INTO purchase_receipt_lines(receipt_id,line_id,lot_id,qty,unit_cost_satang) VALUES($1,$2,$3,$4,$5)',[receipt,row.line_id,lot,row.qty,row.unit_cost_satang]);
    await sql.query('UPDATE purchase_order_lines SET received_qty=received_qty+$1 WHERE id=$2',[row.qty,row.line_id]);
   }
   await sql.query("UPDATE purchase_orders SET version=version+1,status=CASE WHEN NOT EXISTS(SELECT 1 FROM purchase_order_lines WHERE order_id=$1 AND received_qty<qty) THEN 'closed' ELSE 'open' END WHERE id=$1",[id]);
   await record(sql,res.locals.user,'purchase.received','purchase_receipt',receipt,{order_id:id,lines:p.lines});return receipt;
  });res.status(201).json({id:receipt});
 });
 r.post('/purchase-orders/:id/cancel',async(req,res)=>{
  const id=idSchema.parse(req.params.id),p=z.object({expected_version:z.number().int().positive(),reason:text}).strict().parse(req.body);
  await db.transaction(async sql=>{fail((await sql.query("UPDATE purchase_orders SET status='cancelled',version=version+1 WHERE id=$1 AND version=$2 AND status='open' RETURNING id",[id,p.expected_version])).rows[0],409,'VERSION_CONFLICT');await record(sql,res.locals.user,'purchase.cancelled','purchase_order',id,{reason:p.reason,note:'Previously received goods remain in inventory'});});res.sendStatus(204);
 });
 r.get('/inventory-valuation',async(_req,res)=>{
  fail(res.locals.user.role==='owner',403,'FORBIDDEN');res.json({valuation:(await db.query(`SELECT s.branch_id,s.ingredient_id,i.name,i.unit,s.current_stock,s.counted_at,
   coalesce(sum(l.remaining_qty*l.unit_cost_satang) FILTER(WHERE l.unit_cost_satang IS NOT NULL),0) AS known_value_satang,
   coalesce(sum(l.remaining_qty) FILTER(WHERE l.unit_cost_satang IS NULL),0) AS unknown_cost_qty,
   coalesce(sum(l.remaining_qty) FILTER(WHERE l.expires_on<=(now() AT TIME ZONE 'Asia/Bangkok')::date),0) AS expired_qty,
   s.current_stock-coalesce(sum(l.remaining_qty),0) AS unallocated_difference
   FROM branch_stock s JOIN ingredients i ON i.id=s.ingredient_id LEFT JOIN inventory_lots l ON l.branch_id=s.branch_id AND l.ingredient_id=s.ingredient_id GROUP BY s.branch_id,s.ingredient_id,i.name,i.unit,s.current_stock,s.counted_at ORDER BY i.name`)).rows});
 });
 r.get('/operating-expenses/summary',async(req,res)=>{
  fail(res.locals.user.role==='owner',403,'FORBIDDEN');const p=dateRange.parse(req.query),values=[p.date_from,p.date_to];
  const cash=(await db.query(`SELECT coalesce(sum(amount_satang) FILTER(WHERE (paid_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date),0) AS received_satang,
   coalesce(sum(amount_satang) FILTER(WHERE status='refunded' AND (refunded_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date),0) AS refunded_satang FROM payments`,values)).rows[0];
  const expenses=(await db.query('SELECT coalesce(sum(amount_satang),0) AS amount_satang FROM operating_expenses WHERE voided_at IS NULL AND date BETWEEN $1 AND $2',values)).rows[0];
  const costs=(await db.query(`SELECT coalesce(sum(a.qty * -l.unit_cost_satang) FILTER(WHERE l.unit_cost_satang IS NOT NULL),0) AS known_consumed_cost_satang,
   count(DISTINCT p.order_id) FILTER(WHERE l.unit_cost_satang IS NULL OR a.movement_id IS NULL)::int AS orders_with_unknown_cost
   FROM payments p LEFT JOIN stock_movements m ON p.order_id=m.ref_order_id AND m.type='sale'
   LEFT JOIN lot_allocations a ON a.movement_id=m.id LEFT JOIN inventory_lots l ON l.id=a.lot_id
   WHERE p.status='paid' AND (p.paid_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date`,values)).rows[0];
  res.json({cash,expenses,costs,basis:'Cash dates for receipts/refunds; known consumed lot cost for non-refunded paid orders; incomplete costs are disclosed. This is not audited net profit.'});
 });
 r.get('/operating-expenses',async(req,res)=>{fail(res.locals.user.role==='owner',403,'FORBIDDEN');const p=dateRange.parse(req.query);res.json({expenses:(await db.query('SELECT * FROM operating_expenses WHERE date BETWEEN $1 AND $2 ORDER BY date DESC,created_at DESC,id LIMIT 500',[p.date_from,p.date_to])).rows});});
 r.post('/operating-expenses',async(req,res)=>{
  fail(res.locals.user.role==='owner',403,'FORBIDDEN');const p=z.object({date:dateSchema,category:text,amount_satang:z.number().int().positive().max(1e10),note:note.refine(v=>v.length>0),request_key:idSchema}).strict().parse(req.body);fail(p.date<=businessDate(),400,'FUTURE_DATE');
  const id=await db.transaction(async sql=>{
   await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,21))',[p.request_key]);
   const prior=(await sql.query('SELECT *,date::text AS date FROM operating_expenses WHERE request_key=$1',[p.request_key])).rows[0];if(prior){fail(prior.date===p.date&&prior.category===p.category&&Number(prior.amount_satang)===p.amount_satang&&prior.note===p.note,409,'REQUEST_KEY_CONFLICT');return prior.id;}
   const id=randomUUID();await sql.query('INSERT INTO operating_expenses(id,date,category,amount_satang,note,created_by,request_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,p.date,p.category,p.amount_satang,p.note,res.locals.user.id,p.request_key]);await record(sql,res.locals.user,'expense.created','operating_expense',id,p);return id;
  });res.status(201).json({id});
 });
 r.post('/operating-expenses/:id/void',async(req,res)=>{
  fail(res.locals.user.role==='owner',403,'FORBIDDEN');const id=idSchema.parse(req.params.id),p=z.object({reason:text}).strict().parse(req.body);
  await db.transaction(async sql=>{fail((await sql.query('UPDATE operating_expenses SET voided_at=now(),void_reason=$1 WHERE id=$2 AND voided_at IS NULL RETURNING id',[p.reason,id])).rows[0],409,'VERSION_CONFLICT');await record(sql,res.locals.user,'expense.voided','operating_expense',id,p);});res.sendStatus(204);
 });return r;
}
