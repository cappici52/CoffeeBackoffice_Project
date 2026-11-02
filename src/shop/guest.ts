import {Router} from 'express';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import type {Database,Sql} from '../db.js';
import type {Config} from '../config.js';
import {tokenHash} from '../security.js';
import {createInput,createOrder} from './orders.js';
import {fail,idSchema,note} from './shared.js';
import {publicOrigin} from './tables.js';

const token=z.string().regex(/^[a-f0-9]{64}$/);
export async function guestOrder(sql:Sql,trackingHash:string){
 const order=(await sql.query("SELECT o.order_no,o.table_no,o.status,o.note,o.total_satang,o.created_at,o.completed_at,o.cancel_reason,p.status AS payment_status FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE o.source='qr' AND o.guest_tracking_hash=$1",[trackingHash])).rows[0];
 fail(order,404,'ORDER_NOT_FOUND');
 const items=(await sql.query("SELECT i.id,i.product_name,i.qty,i.unit_price_satang,i.status,i.note,i.options,i.started_at,i.completed_at FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.guest_tracking_hash=$1 ORDER BY i.product_name,i.id",[trackingHash])).rows;
 return {...order,items:items.map(i=>({...i,options:i.options.map((o:{name:string;group_name:string;extra_price_satang:number})=>({name:o.name,group_name:o.group_name,extra_price_satang:o.extra_price_satang}))})),server_time:new Date().toISOString()};
}
export function guestRouter(db:Database,config:Config){
 const r=Router();
 r.use((_req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});next();});
 r.use((req,res,next)=>{const origin=req.get('Origin');const allowed=[config.APP_ORIGIN,publicOrigin(config)].includes(origin??'');if(allowed){res.set('Access-Control-Allow-Origin',origin!);res.vary('Origin');}if(req.method==='OPTIONS'){fail(allowed,403,'ORIGIN_FORBIDDEN');res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.set('Access-Control-Allow-Headers','Content-Type');res.sendStatus(204);return;}if(!['GET','HEAD'].includes(req.method))fail(allowed,403,'ORIGIN_FORBIDDEN');next();});
 r.use(rateLimit({windowMs:15*60_000,limit:6000,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'TOO_MANY_REQUESTS'}}));
 const submitLimit=rateLimit({windowMs:15*60_000,limit:120,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'TABLE_ORDER_LIMIT'}});
 r.get('/tables/:token',async(req,res)=>{
  const qr=token.parse(req.params.token);const table=(await db.query('SELECT name FROM dining_tables WHERE qr_token=$1 AND is_active',[qr])).rows[0];fail(table,404,'TABLE_UNAVAILABLE');
  const products=(await db.query('SELECT p.id,p.category_id,p.name,p.description,p.price_satang,p.image_url,p.is_available FROM products p WHERE p.is_available AND NOT p.is_archived AND EXISTS(SELECT 1 FROM recipes r WHERE r.product_id=p.id) ORDER BY p.name,p.id')).rows;
  const groups=(await db.query('SELECT id,product_id,name,is_required,multi_select FROM product_option_groups ORDER BY sort_order,id')).rows;
  const options=(await db.query('SELECT id,group_id,name,extra_price_satang FROM product_options ORDER BY sort_order,id')).rows;
  const categories=(await db.query('SELECT id,name,sort_order FROM categories ORDER BY sort_order,name')).rows;
  res.json({table:{name:table.name},categories,products:products.map(p=>({...p,option_groups:groups.filter(g=>g.product_id===p.id).map(g=>({id:g.id,name:g.name,is_required:g.is_required,multi_select:g.multi_select,options:options.filter(o=>o.group_id===g.id).map(o=>({id:o.id,name:o.name,extra_price_satang:o.extra_price_satang}))}))}))});
 });
 r.post('/tables/:token/orders',submitLimit,async(req,res)=>{
  const qr=token.parse(req.params.token);const body=z.object({request_key:idSchema,tracking_token:token,note:note.default(''),items:createInput.shape.items.max(20)}).strict().parse(req.body);
  const table=(await db.query('SELECT id,name FROM dining_tables WHERE qr_token=$1 AND is_active',[qr])).rows[0];fail(table,404,'TABLE_UNAVAILABLE');
  const trackingHash=tokenHash(body.tracking_token);await createOrder(db,createInput.parse({request_key:body.request_key,type:'dine-in',table_no:table.name,note:body.note,items:body.items}),null,{table_id:table.id,table_token:qr,tracking_hash:trackingHash});
  res.status(201).json({order:await guestOrder(db,trackingHash)});
 });
 r.get('/orders/:token',async(req,res)=>res.json({order:await guestOrder(db,tokenHash(token.parse(req.params.token)))}));
 r.use((_req,res)=>res.status(404).json({error:'NOT_FOUND'}));return r;
}
