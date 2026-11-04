import { randomUUID } from 'node:crypto';
import { Router,type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { idSchema,dateSchema,quantity,text,note,pagination,fail,moveStock,record } from './shared.js';

export function lotsRouter(db:Database,auth:RequestHandler,manage:RequestHandler){
 const r=Router();r.use('/inventory-lots',auth,manage);
 r.get('/inventory-lots',async(req,res)=>{
  const p=pagination.extend({ingredient_id:idSchema.optional(),expired:z.enum(['true','false']).default('false')}).strict().parse(req.query);
  const filter="remaining_qty>0 AND ($1::uuid IS NULL OR ingredient_id=$1) AND (NOT $2::boolean OR expires_on<=(now() AT TIME ZONE 'Asia/Bangkok')::date)";
  const rows=await db.query(`SELECT l.*,i.name,i.unit,(l.expires_on<=(now() AT TIME ZONE 'Asia/Bangkok')::date) AS expired FROM inventory_lots l JOIN ingredients i ON i.id=l.ingredient_id WHERE ${filter} ORDER BY expires_on NULLS LAST,received_at,l.id LIMIT $3 OFFSET $4`,[p.ingredient_id??null,p.expired==='true',p.page_size,(p.page-1)*p.page_size]);
  const total=(await db.query(`SELECT count(*)::int AS n FROM inventory_lots WHERE ${filter}`,[p.ingredient_id??null,p.expired==='true'])).rows[0]!.n;
  res.json({lots:rows.rows,total,...p});
 });
 r.post('/inventory-lots/receive',async(req,res)=>{
  const p=z.object({ingredient_id:idSchema,qty:quantity,code:text,expires_on:dateSchema.nullable(),no_expiry:z.boolean().default(false),unit_cost_satang:z.number().min(0).max(1e8).nullable(),reason:note.refine(v=>v.length>0)}).strict().parse(req.body);
  fail(!p.no_expiry||p.expires_on===null,400,'INVALID_EXPIRY_STATUS');
  const id=randomUUID();
  await db.transaction(async sql=>{
   fail((await sql.query('SELECT s.ingredient_id FROM branch_stock s JOIN ingredients i ON i.id=s.ingredient_id WHERE s.ingredient_id=$1 AND s.branch_id=coffee_current_branch() AND i.is_active FOR UPDATE OF s',[p.ingredient_id])).rows[0],404,'NOT_FOUND');
   await sql.query('INSERT INTO inventory_lots(id,ingredient_id,code,expires_on,unit_cost_satang,expiry_kind) VALUES($1,$2,$3,$4,$5,$6)',[id,p.ingredient_id,p.code,p.expires_on,p.unit_cost_satang,p.no_expiry?'none':p.expires_on?'dated':'unknown']);
   await moveStock(sql,res.locals.user,p.ingredient_id,'receipt',p.qty,p.reason,null,null,id);
   await record(sql,res.locals.user,'lot.received','inventory_lot',id,p);
  });res.status(201).json({id});
 });
 r.post('/inventory-lots/:id/waste',async(req,res)=>{
  const id=idSchema.parse(req.params.id),p=z.object({qty:quantity,reason:text}).strict().parse(req.body);
  await db.transaction(async sql=>{
   const lot=(await sql.query('SELECT ingredient_id FROM inventory_lots WHERE id=$1',[id])).rows[0];fail(lot,404,'NOT_FOUND');
   await moveStock(sql,res.locals.user,lot.ingredient_id,'waste',-p.qty,p.reason,null,null,id);
   await record(sql,res.locals.user,'lot.wasted','inventory_lot',id,p);
  });res.sendStatus(204);
 });return r;
}
