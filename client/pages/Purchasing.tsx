import { useState } from 'react';
import { useAuth } from '../App';
import { Form,Input,Select,Textarea,Submit,QueryState,Modal,CheckField } from '../ui';
import { useResource,mutate,number,money,dateText,today,addDays } from '../lib';
type Supplier={id:string;name:string;phone:string;lead_time_days:number;is_active:boolean;version:number};
type Order={id:string;status:string;version:number;expected_on:string;supplier_name:string;note:string};
type Line={id:string;ingredient_id:string;name:string;unit:string;qty:string;received_qty:string;unit_cost_satang:string};
export default function Purchasing(){
 const owner=useAuth().user.role==='owner';const [id,setId]=useState(''),[editing,setEditing]=useState<Supplier|null>(null);
 const suppliers=useResource<{suppliers:Supplier[]}>('/suppliers');
 const stock=useResource<{ingredients:{id:string;name:string;unit:string}[]}>('/ingredient-catalog');
 const orders=useResource<{orders:Order[]}>('/purchase-orders');
 const detail=useResource<{order:Order;lines:Line[];receipts:{id:string;created_at:string}[]}>(id?'/purchase-orders/'+id:null);
 const [supplierId,setSupplierId]=useState('');
 const selected=suppliers.data?.suppliers.find(s=>s.id===supplierId);
 return <>
  <details className="section-details"><summary>ซัพพลายเออร์</summary>
   <QueryState {...suppliers} retry={suppliers.reload}/>
   {suppliers.data?.suppliers.map(s=><div className="row" key={s.id}><span>{s.name} · {s.phone||'ไม่ระบุเบอร์'} · ส่ง {s.lead_time_days} วัน · {s.is_active?'ใช้งาน':'ปิดใช้งาน'}</span>{owner&&<button onClick={()=>setEditing(s)}>แก้ไข {s.name}</button>}</div>)}
   {owner&&<Form noValidate onSave={async fd=>{await mutate('/suppliers','POST',{name:String(fd.get('name')),phone:String(fd.get('phone')),lead_time_days:Number(fd.get('lead_time_days'))});suppliers.reload();}}><div className="form-grid"><Input label="ชื่อซัพพลายเออร์ใหม่" name="name" required maxLength={120}/><Input label="เบอร์ซัพพลายเออร์ใหม่" name="phone" maxLength={50}/><Input label="เวลาส่งของ (วัน)" name="lead_time_days" type="number" min="0" max="365" required/></div><Submit>เพิ่มซัพพลายเออร์</Submit></Form>}
  </details>
  <details className="section-details"><summary>สร้างใบสั่งซื้อ</summary>
   <QueryState {...stock} retry={stock.reload}/>
   <Form noValidate onSave={async fd=>{
    const lines=(stock.data?.ingredients??[]).filter(i=>String(fd.get('qty_'+i.id)??'').trim()!=='').map(i=>{
     if(String(fd.get('cost_'+i.id)??'').trim()==='')throw Error('กรุณาระบุราคาของ '+i.name);
     return {ingredient_id:i.id,qty:Number(fd.get('qty_'+i.id)),unit_cost_satang:Number((Number(fd.get('cost_'+i.id))*100).toFixed(6))};
    });
    const saved=await mutate<{id:string}>('/purchase-orders','POST',{supplier_id:supplierId,expected_on:String(fd.get('expected_on')),note:String(fd.get('note')),lines});setId(saved.id);orders.reload();
   }}>
    <Select label="ซัพพลายเออร์สำหรับใบสั่งซื้อ" value={supplierId} required onChange={e=>setSupplierId(e.target.value)}><option value="">เลือกซัพพลายเออร์</option>{suppliers.data?.suppliers.filter(s=>s.is_active).map(s=><option key={s.id} value={s.id}>{s.name} · ส่ง {s.lead_time_days} วัน</option>)}</Select>
    <Input key={supplierId} label="คาดว่าจะได้รับวันที่" name="expected_on" type="date" min={today()} defaultValue={addDays(today(),selected?.lead_time_days??0)} required/>
    <p className="caption muted">กรอกเฉพาะวัตถุดิบที่ต้องการซื้อ พร้อมราคาต่อหน่วยฐาน ไม่ใช่ราคาต่อแพ็ก</p>
    <div className="form-grid">{stock.data?.ingredients.map(i=><div key={i.id}><Input label={`จำนวนสั่ง · ${i.name} (${i.unit})`} name={'qty_'+i.id} type="number" min="0.001" max="1000000" step="0.001"/><Input label={`ราคาต่อ ${i.unit} (บาท) · ${i.name}`} name={'cost_'+i.id} type="number" min="0" max="1000000" step="0.000001"/></div>)}</div>
    <Textarea label="หมายเหตุใบสั่งซื้อ" name="note" maxLength={1000} className="resize-none"/><Submit>บันทึกใบสั่งซื้อ</Submit>
   </Form>
  </details>
  <QueryState {...orders} retry={orders.reload}/>
  <Select label="ใบสั่งซื้อที่บันทึก" value={id} onChange={e=>setId(e.target.value)}><option value="">เลือกใบสั่งซื้อ</option>{orders.data?.orders.map(o=><option key={o.id} value={o.id}>{o.id.slice(0,8)} · {o.supplier_name} · {o.status==='open'?'รอรับ':o.status==='closed'?'รับครบ':'ยกเลิก'} · {dateText(o.expected_on)}</option>)}</Select>
  <QueryState {...detail} retry={detail.reload}/>
  {detail.data&&<>
   <p>{detail.data.order.supplier_name} · คาดรับ {dateText(detail.data.order.expected_on)} · {detail.data.order.note}</p>
   <div className="table-scroll" tabIndex={0} role="region" aria-label="รายการสั่งซื้อ"><table><caption>ใบสั่งซื้อ · การยกเลิกคงรายการที่รับแล้วไว้</caption><thead><tr>{['วัตถุดิบ','สั่ง','รับแล้ว','ค้างรับ','ราคาต่อหน่วย'].map(t=><th scope="col" key={t}>{t}</th>)}</tr></thead><tbody>{detail.data.lines.map(l=><tr key={l.id}><th scope="row">{l.name} ({l.unit})</th><td>{number(l.qty)}</td><td>{number(l.received_qty)}</td><td>{number(Number(l.qty)-Number(l.received_qty))}</td><td>{number(Number(l.unit_cost_satang)/100,6)} บาท</td></tr>)}</tbody></table></div>
   {detail.data.order.status==='open'&&<ReceivePurchase key={id+detail.data.order.version} id={id} lines={detail.data.lines} reload={()=>{detail.reload();orders.reload();}}/>}
   <p className="caption muted">รับสินค้าแล้ว {detail.data.receipts.length} ครั้ง · ใบสั่งซื้อไม่ใช่หลักฐานชำระเงินให้ซัพพลายเออร์</p>
   {detail.data.order.status==='open'&&<Form noValidate guard={false} onSave={async fd=>{await mutate('/purchase-orders/'+id+'/cancel','POST',{expected_version:detail.data!.order.version,reason:String(fd.get('reason'))});detail.reload();orders.reload();}}><Input label="เหตุผลยกเลิกยอดค้างรับ" name="reason" required maxLength={120}/><Submit>ยกเลิกเฉพาะยอดค้างรับ</Submit></Form>}
  </>}
  {editing&&<Modal title={'แก้ซัพพลายเออร์ '+editing.name} onClose={()=>setEditing(null)}><Form noValidate onSave={async fd=>{await mutate('/suppliers/'+editing.id,'PATCH',{name:String(fd.get('name')),phone:String(fd.get('phone')),lead_time_days:Number(fd.get('lead_time_days')),is_active:fd.get('active')==='on',expected_version:editing.version});setEditing(null);suppliers.reload();}}><Input label="ชื่อซัพพลายเออร์" name="name" defaultValue={editing.name} required/><Input label="เบอร์ติดต่อ" name="phone" defaultValue={editing.phone}/><Input label="เวลาส่ง (วัน)" name="lead_time_days" type="number" min="0" max="365" defaultValue={editing.lead_time_days} required/><CheckField label="เปิดใช้งานซัพพลายเออร์" name="active" defaultChecked={editing.is_active}/><Submit>บันทึกซัพพลายเออร์</Submit></Form></Modal>}
 </>;
}
function ReceivePurchase({id,lines,reload}:{id:string;lines:Line[];reload:()=>void}){
 const [key]=useState(()=>crypto.randomUUID());
 return <details className="section-details"><summary>รับสินค้าทั้งหมดหรือบางส่วน</summary><p className="caption muted">จำนวนตามหน่วยฐาน · ระบุรหัสล็อตจริงหรือเลขอ้างอิงรับเข้า · เว้นวันหมดอายุหากไม่ทราบ · ราคาตั้งต้นตามใบสั่งซื้อ แก้เป็นราคาที่รับจริงได้</p><Form noValidate onSave={async fd=>{
  const selected=lines.filter(l=>String(fd.get('qty_'+l.id)??'').trim()!=='').map(l=>{const code=String(fd.get('code_'+l.id));if(!code.trim())throw Error('กรุณาระบุรหัสล็อตของ '+l.name);if(String(fd.get('cost_'+l.id)??'').trim()==='')throw Error('กรุณาระบุราคาที่รับของ '+l.name);return {line_id:l.id,qty:Number(fd.get('qty_'+l.id)),lot_code:code,expires_on:String(fd.get('expiry_'+l.id))||null,no_expiry:fd.get('no_expiry_'+l.id)==='on',unit_cost_satang:Number((Number(fd.get('cost_'+l.id))*100).toFixed(6))};});
  await mutate('/purchase-orders/'+id+'/receive','POST',{request_key:key,lines:selected});reload();
 }}>
  {lines.filter(l=>Number(l.qty)>Number(l.received_qty)).map(l=><div className="form-grid" key={l.id}><Input label={`รับครั้งนี้ · ${l.name} (${l.unit})`} name={'qty_'+l.id} type="number" min="0.001" max={Number(l.qty)-Number(l.received_qty)} step="0.001"/><Input label={`ล็อต · ${l.name}`} name={'code_'+l.id} maxLength={120}/><Input label={`หมดอายุ · ${l.name}`} name={'expiry_'+l.id} type="date"/><CheckField label={`ยืนยันไม่มีวันหมดอายุ · ${l.name}`} name={'no_expiry_'+l.id}/><Input label={`ราคาที่รับต่อ ${l.unit} (บาท) · ${l.name}`} name={'cost_'+l.id} type="number" min="0" max="1000000" step="0.000001" defaultValue={Number(l.unit_cost_satang)/100}/></div>)}<Submit>ยืนยันรับสินค้าเข้าสต็อก</Submit>
 </Form></details>;
}
