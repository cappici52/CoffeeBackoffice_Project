import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Select,QueryState,Notice } from '../ui';
import { useResource,number,dateText,today } from '../lib';
type Plan={ingredient_id:string;name:string;unit:string;counted_at:string|null;first_shortage_on:string|null;order_by:string|null;expected_arrival:string;urgent_shortage_qty:number;planned_order_qty:number;coverage_sufficient:boolean;unknown_expiry_qty:number;overdue_incoming_qty:number;lot_balance_difference:number};
export default function Replenishment(){
 const [supplier,setSupplier]=useState(''),[review,setReview]=useState('7');
 const suppliers=useResource<{suppliers:{id:string;name:string;is_active:boolean;lead_time_days:number}[]}>('/suppliers');
 const result=useResource<{ready:boolean;limited_history?:boolean;reason?:string;run_id?:string;missing_recipe_products?:string[];unforecasted_products?:number;plans:Plan[]}>(supplier?`/replenishment-plan?supplier_id=${supplier}&review_days=${review}`:null);
 const quantity=(n:number,unit:string)=>['ชิ้น','ถุง','ขวด'].includes(unit)?Math.ceil(n):Math.round(n*1000)/1000;
 return <>
  <p className="caption muted">ใช้รอบพยากรณ์อนาคตล่าสุดของข้อมูลร้านที่ไม่ติดป้ายจำลอง × สูตรปัจจุบัน · หักล็อตพร้อมใช้และใบสั่งซื้อที่คาดว่าจะมาทัน · ไม่สร้างใบสั่งซื้ออัตโนมัติ</p>
  <QueryState {...suppliers} retry={suppliers.reload}/>
  <div className="form-grid"><Select label="ซัพพลายเออร์สำหรับแผนสั่งเพิ่ม" value={supplier} onChange={e=>setSupplier(e.target.value)}><option value="">เลือกซัพพลายเออร์และเวลาส่ง</option>{suppliers.data?.suppliers.filter(s=>s.is_active).map(s=><option key={s.id} value={s.id}>{s.name} · ส่ง {s.lead_time_days} วัน</option>)}</Select><Select label="รอบทบทวนการสั่งซื้อ" value={review} onChange={e=>setReview(e.target.value)}><option value="1">ทุก 1 วัน</option><option value="7">ทุก 7 วัน</option><option value="14">ทุก 14 วัน</option></Select></div>
  <QueryState {...result} retry={result.reload}/>
  {result.data?.reason==='NO_GENUINE_FUTURE_FORECAST'&&<Notice>ยังไม่มีพยากรณ์อนาคตจากข้อมูลร้านที่ไม่ติดป้ายจำลอง <Link to="/forecast">ไปสร้างพยากรณ์ร้าน</Link> · ไม่ใช้ผลข้อมูลสาธารณะหรือผลจำลองแทน</Notice>}
  {result.data?.run_id&&<>
   {!result.data.ready&&<Notice>แผนเบื้องต้น ต้องตรวจสต็อก สูตร เมนูที่ยังไม่มีพยากรณ์ และช่วงที่ข้อมูลครอบคลุมก่อนสั่งซื้อ {result.data.limited_history?'· ประวัติยังไม่พอเลือกโมเดล ':''}· เมนูไม่มีสูตร {result.data.missing_recipe_products?.length??0} · เมนูไม่มีพยากรณ์ {result.data.unforecasted_products??0}</Notice>}
   <div className="table-scroll" tabIndex={0} role="region" aria-label="วันที่คาดว่าขาดและแผนสั่งเพิ่ม"><table><caption>แผนตามเวลาส่ง · ของค้างส่งเลยกำหนดไม่ถูกนับว่าได้รับแล้ว</caption><thead><tr>{['วัตถุดิบ','เริ่มเสี่ยงขาด','ควรสั่งภายใน','ขาดก่อนของใหม่มาถึง','เติมถึงรอบทบทวน','ตรวจสอบ'].map(t=><th key={t} scope="col">{t}</th>)}</tr></thead><tbody>{result.data.plans.map(p=><tr key={p.ingredient_id}><th scope="row">{p.name} ({p.unit})</th><td>{p.first_shortage_on?dateText(p.first_shortage_on):'ไม่พบในช่วงที่พยากรณ์'}</td><td>{p.order_by?dateText(p.order_by)+(p.order_by<today()?' · เลยกำหนด':''):'—'}</td><td>{number(quantity(p.urgent_shortage_qty,p.unit))}</td><td>{p.coverage_sufficient?number(quantity(p.planned_order_qty,p.unit)):'ข้อมูลไม่ครบช่วงส่ง + ทบทวน'}</td><td>{p.counted_at?'นับแล้ว':'รอตรวจนับ'} · ไม่ทราบหมดอายุ {number(p.unknown_expiry_qty)} · ค้างส่งเกินกำหนด {number(p.overdue_incoming_qty)} · ผลต่างล็อต {number(p.lot_balance_difference)}</td></tr>)}</tbody></table></div>
   <p className="caption muted">ช่วงเวลาส่งเป็นวันปฏิทิน ไม่รวมวันหยุดซัพพลายเออร์ ตัวเลือกเมนู และของเสีย · ต้องยืนยันวัตถุดิบที่ไม่ทราบวันหมดอายุ · รอบพยากรณ์ {result.data.run_id.slice(0,8)}</p>
  </>}
 </>;
}
