import { randomUUID,createHash } from 'node:crypto';
import { Router,type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { idSchema,quantity,text,fail,moveStock,record } from './shared.js';

export function transfersRouter(db:Database,auth:RequestHandler,manage:RequestHandler){
 const r=Router();r.use('/stock-transfers',auth,manage);
 r.get('/stock-transfers',async(_req,res)=>res.json({transfers:(await db.query('SELECT t.*,s.name AS source_name,d.name AS target_name,i.name,i.unit FROM stock_transfers t JOIN branches s ON s.id=t.source_branch_id JOIN branches d ON d.id=t.target_branch_id JOIN ingredients i ON i.id=t.ingredient_id ORDER BY created_at DESC,id DESC LIMIT 100')).rows}));
 r.post('/stock-transfers',async(req,res)=>{
  const p=z.object({target_branch_id:idSchema,ingredient_id:idSchema,qty:quantity,reason:text,request_key:idSchema}).strict().parse(req.body),source=res.locals.branch.id as string;
  fail(source!==p.target_branch_id,400,'TRANSFER_SAME_BRANCH');
  const hash=createHash('sha256').update(JSON.stringify({source,...p})).digest('hex');
  const id=await db.transaction(async sql=>{
   const actor=(await sql.query("SELECT role FROM users WHERE id=$1 AND is_active AND role IN('owner','manager') FOR SHARE",[res.locals.user.id])).rows[0];fail(actor,403,'FORBIDDEN');
   const target=(await sql.query('SELECT id FROM branches WHERE id=$1 AND is_active FOR SHARE',[p.target_branch_id])).rows[0];fail(target,403,'BRANCH_FORBIDDEN');
   if(actor.role!=='owner')fail((await sql.query('SELECT user_id FROM user_branches WHERE user_id=$1 AND branch_id=$2 FOR SHARE',[res.locals.user.id,p.target_branch_id])).rows[0],403,'BRANCH_FORBIDDEN');
   await sql.query('SELECT pg_advisory_xact_lock(hashtextextended($1,22))',[source+':'+p.request_key]);
   const prior=(await sql.query('SELECT id,input_sha256 FROM stock_transfers WHERE source_branch_id=$1 AND request_key=$2',[source,p.request_key])).rows[0];if(prior){fail(prior.input_sha256===hash,409,'REQUEST_KEY_CONFLICT');return prior.id;}
   for(const branch of [source,p.target_branch_id].sort()){
    await sql.query("SELECT set_config('coffee.branch_ids',$1,true)",[branch]);
    fail((await sql.query('SELECT ingredient_id FROM branch_stock WHERE branch_id=$1 AND ingredient_id=$2 FOR UPDATE',[branch,p.ingredient_id])).rows[0],404,'NOT_FOUND');
   }
   await sql.query("SELECT set_config('coffee.branch_ids',$1,true)",[source]);
   const lots=(await sql.query("SELECT * FROM inventory_lots WHERE ingredient_id=$1 AND branch_id=$2 AND remaining_qty>0 AND (expires_on IS NULL OR expires_on>(now() AT TIME ZONE 'Asia/Bangkok')::date) ORDER BY expires_on NULLS LAST,received_at,id FOR UPDATE",[p.ingredient_id,source])).rows;
   fail(lots.reduce((s,l)=>s+Number(l.remaining_qty),0)+.0000001>=p.qty,409,'EXPIRED_OR_INSUFFICIENT_LOT_STOCK');
   const id=randomUUID();await sql.query('INSERT INTO stock_transfers(id,source_branch_id,target_branch_id,ingredient_id,qty,created_by,reason,request_key,input_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,source,p.target_branch_id,p.ingredient_id,p.qty,res.locals.user.id,p.reason,p.request_key,hash]);
   let left=p.qty;
   for(const lot of lots){
    const qty=Math.min(left,Number(lot.remaining_qty));if(qty<=0)break;
    await sql.query("SELECT set_config('coffee.branch_ids',$1,true)",[source]);
    await moveStock(sql,res.locals.user,p.ingredient_id,'transfer_out',-qty,p.reason,null,null,lot.id,id);
    await sql.query("SELECT set_config('coffee.branch_ids',$1,true)",[p.target_branch_id]);
    const targetLot=randomUUID();await sql.query('INSERT INTO inventory_lots(id,ingredient_id,code,expires_on,unit_cost_satang,legacy_unknown,expiry_kind) VALUES($1,$2,$3,$4,$5,$6,$7)',[targetLot,p.ingredient_id,lot.code,lot.expires_on,lot.unit_cost_satang,lot.legacy_unknown,lot.expiry_kind]);
    await moveStock(sql,res.locals.user,p.ingredient_id,'transfer_in',qty,p.reason,null,null,targetLot,id);
    left=Math.round((left-qty)*1000)/1000;
   }
   await record(sql,res.locals.user,'transfer.received','stock_transfer',id,{source,qty:p.qty});
   await sql.query("SELECT set_config('coffee.branch_ids',$1,true)",[source]);
   await record(sql,res.locals.user,'transfer.sent','stock_transfer',id,p);return id;
  });res.status(201).json({id});
 });return r;
}
