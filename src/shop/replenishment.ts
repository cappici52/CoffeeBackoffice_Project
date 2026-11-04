import { Router,type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { idSchema,businessDate,fail } from './shared.js';
const add=(d:string,n:number)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
type Lot={qty:number;expires_on:string|null};
export function projectReplenishment(today:string,lead:number,review:number,demand:{date:string;qty:number}[],stock:Lot[],incoming:{date:string;qty:number}[]){
 const arrival=add(today,lead),end=add(arrival,review-1);
 const lots=stock.map(l=>({...l}));let first:string|null=null,urgent=0,planned=0;
 const arrivals=incoming.filter(p=>p.date>=today).map(p=>({...p,added:false}));
 const daily=[];
 for(const point of [...demand].filter(d=>d.date>=today).sort((a,b)=>a.date.localeCompare(b.date))){
  for(const lot of lots)if(lot.expires_on!==null&&lot.expires_on<=point.date)lot.qty=0;
  // An overdue PO is uncertain, not stock already received.
  for(const p of arrivals.filter(p=>!p.added&&p.date<=point.date)){lots.push({qty:p.qty,expires_on:null});p.added=true;}
  let needed=point.qty;
  for(const lot of lots.sort((a,b)=>(a.expires_on??'9999-12-31').localeCompare(b.expires_on??'9999-12-31'))){const used=Math.min(needed,lot.qty);lot.qty-=used;needed-=used;}
  needed=Math.max(0,Math.round(needed*1000)/1000);
  if(needed>0){first??=point.date;if(point.date<arrival)urgent+=needed;else if(point.date<=end)planned+=needed;}
  daily.push({date:point.date,demand:point.qty,shortage:needed,projected_remaining:lots.reduce((s,l)=>s+l.qty,0)});
 }
 return {first_shortage_on:first,order_by:first?add(first,-lead):null,expected_arrival:arrival,
  review_through:end,urgent_shortage_qty:urgent,planned_order_qty:planned,
  coverage_sufficient:daily.length>0&&daily.at(-1)!.date>=end,daily};
}
export function replenishmentRouter(db:Database,auth:RequestHandler,manage:RequestHandler){
 const r=Router();r.use('/replenishment-plan',auth,manage);
 r.get('/replenishment-plan',async(req,res)=>{
  const p=z.object({supplier_id:idSchema,run_id:idSchema.optional(),review_days:z.coerce.number().int().min(1).max(14).default(7)}).strict().parse(req.query);
  const supplier=(await db.query('SELECT * FROM suppliers WHERE id=$1 AND is_active',[p.supplier_id])).rows[0];fail(supplier,404,'NOT_FOUND');
  const today=businessDate();
  const run=(await db.query("SELECT *,date_from::text AS date_from,date_to::text AS date_to FROM forecast_runs WHERE ($1::uuid IS NULL OR id=$1) AND training_cohort='genuine' AND NOT contains_simulated_sales AND date_to >= $2::date ORDER BY generated_at DESC,id DESC LIMIT 1",[p.run_id??null,today])).rows[0];
  if(!run){res.json({ready:false,reason:'NO_GENUINE_FUTURE_FORECAST',plans:[]});return;}
  const rows=(await db.query('SELECT forecast_date::text AS date,product_id,predicted_qty,diagnostics FROM forecast_run_points WHERE run_id=$1 ORDER BY forecast_date,product_id',[run.id])).rows;
  const limitedHistory=rows.some(r=>r.diagnostics?.reason==='limited_history_mean');
  const ids=[...new Set(rows.map(r=>r.product_id))];
  const recipes=(await db.query('SELECT product_id,ingredient_id,qty FROM recipe_ingredients WHERE product_id=ANY($1::uuid[])',[ids])).rows;
  const missingRecipes=ids.filter(id=>!recipes.some(r=>r.product_id===id));
  const ingredients=(await db.query('SELECT * FROM stock_ingredients WHERE is_active AND id=ANY($1::uuid[])',[[...new Set(recipes.map(r=>r.ingredient_id))]])).rows;
  const lots=(await db.query('SELECT ingredient_id,remaining_qty,expires_on::text,expiry_kind FROM inventory_lots WHERE remaining_qty>0')).rows;
  const incoming=(await db.query("SELECT l.ingredient_id,p.expected_on::text AS date,l.qty-l.received_qty AS qty FROM purchase_order_lines l JOIN purchase_orders p ON p.id=l.order_id WHERE p.status='open' AND l.received_qty<l.qty")).rows;
  const dates=[...new Set(rows.map(r=>r.date as string))].sort();
  const complete=dates.length===(Date.parse(run.date_to)-Date.parse(run.date_from))/86400000+1&&dates.every(date=>new Set(rows.filter(r=>r.date===date).map(r=>r.product_id)).size===ids.length);
  const unforecasted=(await db.query('SELECT count(*)::int AS n FROM branch_catalog WHERE NOT is_archived AND is_available AND NOT(id=ANY($1::uuid[]))',[ids])).rows[0]!.n;
  const plans=ingredients.map(i=>{
   const daily=dates.map(date=>({date,qty:rows.filter(r=>r.date===date).reduce((s,r)=>s+Number(r.predicted_qty)*recipes.filter(l=>l.product_id===r.product_id&&l.ingredient_id===i.id).reduce((sum,l)=>sum+Number(l.qty),0),0)}));
   const own=lots.filter(l=>l.ingredient_id===i.id),qty=own.reduce((s,l)=>s+Number(l.remaining_qty),0);
   return {ingredient_id:i.id,name:i.name,unit:i.unit,counted_at:i.counted_at,
    lot_balance_difference:Number(i.current_stock)-qty,unknown_expiry_qty:own.filter(l=>l.expiry_kind==='unknown').reduce((s,l)=>s+Number(l.remaining_qty),0),
    overdue_incoming_qty:incoming.filter(l=>l.ingredient_id===i.id&&l.date<today).reduce((s,l)=>s+Number(l.qty),0),
    ...projectReplenishment(today,supplier.lead_time_days,p.review_days,daily,own.map(l=>({qty:Number(l.remaining_qty),expires_on:l.expires_on})),incoming.filter(l=>l.ingredient_id===i.id).map(l=>({date:l.date,qty:Number(l.qty)})))};
  });
  res.json({ready:complete&&!limitedHistory&&!missingRecipes.length&&!unforecasted&&plans.every(p=>p.counted_at&&p.coverage_sufficient&&p.lot_balance_difference===0&&p.unknown_expiry_qty===0&&p.overdue_incoming_qty===0),
   run_id:run.id,supplier:{name:supplier.name,lead_time_days:supplier.lead_time_days},review_days:p.review_days,
   missing_recipe_products:missingRecipes,unforecasted_products:unforecasted,complete_daily_predictions:complete,limited_history:limitedHistory,plans,
   assumptions:['Base recipes only; options and spoilage not predicted.','Incoming POs are expected, not confirmed arrivals.','Unknown-expiry stock is provisionally usable; physical verification required.','Calendar-day supplier lead time; no automatic purchase order.']});
 });return r;
}
