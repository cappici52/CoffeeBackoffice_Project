import { randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { fail, idSchema, moveStock, record, note } from './shared.js';

export function stocktakesRouter(db:Database,auth:RequestHandler,manage:RequestHandler){
 const r=Router();r.use('/stocktakes',auth,manage);
 r.get('/stocktakes',async(_req,res)=>res.json({stocktakes:(await db.query('SELECT s.*,u.name AS created_by_name FROM stocktakes s JOIN users u ON u.id=s.created_by ORDER BY created_at DESC,id DESC LIMIT 100')).rows}));
 r.get('/stocktakes/:id',async(req,res)=>{
  const id=idSchema.parse(req.params.id),s=(await db.query('SELECT * FROM stocktakes WHERE id=$1',[id])).rows[0];fail(s,404,'NOT_FOUND');
  res.json({stocktake:s,lines:(await db.query('SELECT l.*,i.name,i.unit FROM stocktake_lines l JOIN ingredients i ON i.id=l.ingredient_id WHERE stocktake_id=$1 ORDER BY i.name',[id])).rows});
 });
 r.post('/stocktakes',async(req,res)=>{
  const p=z.object({note:note.refine(v=>v.length>0),lines:z.array(z.object({ingredient_id:idSchema,counted_qty:z.number().min(0).max(1e8).multipleOf(.001),expected_version:z.number().int().positive()}).strict()).min(1).max(500)}).strict().parse(req.body);
  fail(new Set(p.lines.map(l=>l.ingredient_id)).size===p.lines.length,400,'DUPLICATE_INGREDIENT');
  const id=randomUUID();
  await db.transaction(async sql=>{
   await sql.query('INSERT INTO stocktakes(id,created_by,note) VALUES($1,$2,$3)',[id,res.locals.user.id,p.note]);
   for(const l of [...p.lines].sort((a,b)=>a.ingredient_id.localeCompare(b.ingredient_id))){
    const s=(await sql.query('SELECT s.current_stock,s.version FROM branch_stock s JOIN ingredients i ON i.id=s.ingredient_id WHERE s.branch_id=coffee_current_branch() AND s.ingredient_id=$1 AND i.is_active FOR SHARE OF s',[l.ingredient_id])).rows[0];
    fail(s,404,'NOT_FOUND');fail(s.version===l.expected_version,409,'VERSION_CONFLICT');
    await sql.query('INSERT INTO stocktake_lines(stocktake_id,ingredient_id,counted_qty,system_qty,stock_version) VALUES($1,$2,$3,$4,$5)',[id,l.ingredient_id,l.counted_qty,s.current_stock,s.version]);
   }
   await record(sql,res.locals.user,'stocktake.created','stocktake',id,{line_count:p.lines.length});
  });res.status(201).json({id});
 });
 r.post('/stocktakes/:id/commit',async(req,res)=>{
  const id=idSchema.parse(req.params.id);z.object({}).strict().parse(req.body);
  await db.transaction(async sql=>{
   const s=(await sql.query('SELECT * FROM stocktakes WHERE id=$1 FOR UPDATE',[id])).rows[0];fail(s,404,'NOT_FOUND');if(s.status==='committed')return;
   const lines=(await sql.query('SELECT * FROM stocktake_lines WHERE stocktake_id=$1 ORDER BY ingredient_id',[id])).rows;
   for(const l of lines){
    const current=(await sql.query('SELECT current_stock,version FROM branch_stock WHERE branch_id=coffee_current_branch() AND ingredient_id=$1 FOR UPDATE',[l.ingredient_id])).rows[0];
    fail(current && current.version===l.stock_version,409,'VERSION_CONFLICT');
    const delta=Math.round((Number(l.counted_qty)-Number(current.current_stock))*1000)/1000;
    if(delta)await moveStock(sql,res.locals.user,l.ingredient_id,'adjustment',delta,s.note,null,id);
    await sql.query('UPDATE branch_stock SET counted_at=now(),last_stocktake_id=$1,version=version+1 WHERE branch_id=coffee_current_branch() AND ingredient_id=$2',[id,l.ingredient_id]);
   }
   await sql.query("UPDATE stocktakes SET status='committed',committed_at=now() WHERE id=$1",[id]);
   await record(sql,res.locals.user,'stocktake.committed','stocktake',id,{lines:lines.length});
  });res.sendStatus(204);
 });return r;
}
