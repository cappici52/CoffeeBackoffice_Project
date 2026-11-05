import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Select,QueryState,Notice } from '../ui';
import { useResource,number,dateText,today } from '../lib';
type Plan={ingredient_id:string;name:string;unit:string;counted_at:string|null;first_shortage_on:string|null;order_by:string|null;expected_arrival:string;demand_from:string;review_through:string;urgent_shortage_qty:number;planned_order_qty:number;coverage_sufficient:boolean;unknown_expiry_qty:number;overdue_incoming_qty:number;lot_balance_difference:number};
export default function Replenishment(){
 const [supplier,setSupplier]=useState(''),[review,setReview]=useState('7');
 const suppliers=useResource<{suppliers:{id:string;name:string;is_active:boolean;lead_time_days:number}[]}>('/suppliers');
 const result=useResource<{ready:boolean;limited_history?:boolean;reason?:string;run_id?:string;complete_daily_predictions?:boolean;missing_recipe_products?:string[];unforecasted_products?:number;plans:Plan[]}>(supplier?`/replenishment-plan?supplier_id=${supplier}&review_days=${review}`:null);
 const plan=result.data;
 const complete=plan?.complete_daily_predictions&&!plan.missing_recipe_products?.length&&!plan.unforecasted_products;
 const window=plan?.plans[0];
 const quantity=(n:number,unit:string)=>['ชิ้น','ถุง','ขวด'].includes(unit)?Math.ceil(n):Math.round(n*1000)/1000;
 return <>
  <p className="caption muted">คำนวณจากพยากรณ์ร้านและสูตรพื้นฐาน หักสต็อกตามวันหมดอายุและของที่คาดว่าจะได้รับทัน</p>
  <QueryState {...suppliers} retry={suppliers.reload}/>
  {suppliers.data&&!suppliers.data.suppliers.some(s=>s.is_active)&&<Notice>ยังไม่มีซัพพลายเออร์ที่เปิดใช้งาน ให้เจ้าของร้านเพิ่มข้อมูลและเวลาส่งของในแท็บจัดซื้อ</Notice>}
  <div className="form-grid"><Select label="ซัพพลายเออร์สำหรับแผนสั่งเพิ่ม" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">เลือกซัพพลายเออร์และเวลาส่ง</option>{suppliers.data?.suppliers.filter(s=>s.is_active).map(s=><option key={s.id} value={s.id}>{s.name} · ส่ง {s.lead_time_days} วัน</option>)}</Select><Select label="รอบทบทวนการสั่งซื้อ" value={review} onChange={e=>setReview(e.target.value)}><option value="1">ทุก 1 วัน</option><option value="7">ทุก 7 วัน</option><option value="14">ทุก 14 วัน</option></Select></div>
  <QueryState {...result} retry={result.reload}/>
  {result.data?.reason==='NO_GENUINE_FUTURE_FORECAST'&&<Notice>ยังไม่มีพยากรณ์อนาคตจากข้อมูลร้านที่ไม่ติดป้ายจำลอง <Link to="/forecast">ไปสร้างพยากรณ์ร้าน</Link> · ไม่ใช้ผลข้อมูลสาธารณะหรือผลจำลองแทน</Notice>}
  {result.data?.run_id&&<>
   {!result.data.ready&&<Notice>แผนเบื้องต้น ตรวจข้อมูลก่อนสั่งซื้อ{result.data.limited_history?' · ประวัติขายยังน้อย':''}{!result.data.complete_daily_predictions?' · พยากรณ์รายวันไม่ครบ':''}{!!result.data.missing_recipe_products?.length&&` · เมนูที่ต้องแก้สูตร ${result.data.missing_recipe_products.length}`}{!!result.data.unforecasted_products&&` · เมนูที่ยังไม่มีพยากรณ์ ${result.data.unforecasted_products}`}</Notice>}
   {window&&<p className="caption muted">คาดว่าของใหม่มาถึง {dateText(window.expected_arrival)} · คำนวณถึง {dateText(window.review_through)}{window.demand_from>today()?' · เริ่มคิดความต้องการตั้งแต่พรุ่งนี้':''}</p>}
   {result.data.plans.length>0&&<div className="table-scroll" tabIndex={0} role="region" aria-label="วันที่คาดว่าขาดและแผนสั่งเพิ่ม"><table><caption>ปริมาณตามหน่วยฐานของวัตถุดิบ</caption><thead><tr>{['วัตถุดิบ','เริ่มเสี่ยงขาด','ควรสั่งภายใน','ขาดก่อนของมาถึง','เติมถึงรอบทบทวน','ตรวจสอบ'].map(t=><th key={t} scope="col">{t}</th>)}</tr></thead><tbody>{result.data.plans.map(p=>{
    const covered=complete&&p.coverage_sufficient;
    return <tr key={p.ingredient_id}><th scope="row">{p.name} ({p.unit})</th><td>{covered?(p.first_shortage_on?dateText(p.first_shortage_on):'ไม่พบในช่วงพยากรณ์'):'—'}</td><td>{covered&&p.order_by?dateText(p.order_by)+(p.order_by<today()?' · เลยกำหนด':''):'—'}</td><td>{covered?number(p.urgent_shortage_qty):'—'}</td><td>{covered?number(quantity(p.planned_order_qty,p.unit)):'พยากรณ์ไม่ครบรอบ'}</td><td>{[p.counted_at?null:'รอตรวจนับ',p.unknown_expiry_qty>0?`ไม่ทราบวันหมดอายุ ${number(p.unknown_expiry_qty)}`:null,p.overdue_incoming_qty>0?`ค้างส่ง ${number(p.overdue_incoming_qty)}`:null,p.lot_balance_difference!==0?`ผลต่างล็อต ${number(p.lot_balance_difference)}`:null].filter(Boolean).join(' · ')||'ตรวจข้อมูลผ่าน'}</td></tr>;
   })}</tbody></table></div>}
   <p className="caption muted">ใช้วันปฏิทินและสูตรพื้นฐาน ของที่เลยกำหนดส่งจะไม่นับเข้าสต็อก · รอบพยากรณ์ {result.data.run_id.slice(0,8)}</p>
  </>}
 </>;
}
