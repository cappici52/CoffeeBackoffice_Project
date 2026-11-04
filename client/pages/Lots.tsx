import { useState } from 'react';
import { Form,Input,Select,Submit,QueryState,Notice,Modal,Textarea,CheckField } from '../ui';
import { useResource,mutate,number,dateText,money } from '../lib';
type Lot={expiry_kind:string;id:string;name:string;unit:string;code:string;remaining_qty:string;expires_on:string|null;expired:boolean;legacy_unknown:boolean;unit_cost_satang:string|null};
export default function Lots(){
 const [page,setPage]=useState(1),[waste,setWaste]=useState<Lot|null>(null);
 const list=useResource<{lots:Lot[];total:number}>('/inventory-lots?page='+page);
 const ingredients=useResource<{ingredients:{id:string;name:string;unit:string}[]}>('/ingredient-catalog');
 return <>
  <p className="caption muted">ขายจากล็อตที่หมดอายุก่อน (FEFO) · วันหมดอายุคือวันแรกที่ใช้ขายไม่ได้ · ล็อตไม่ทราบวันหมดอายุยังต้องตรวจสอบ</p>
  <details className="section-details"><summary>รับเข้าพร้อมข้อมูลล็อต</summary>
   <Form noValidate onSave={async fd=>{
    await mutate('/inventory-lots/receive','POST',{ingredient_id:String(fd.get('ingredient_id')),qty:Number(fd.get('qty')),code:String(fd.get('code')),expires_on:String(fd.get('expires_on'))||null,no_expiry:fd.get('no_expiry')==='on',unit_cost_satang:String(fd.get('cost')).trim()===''?null:Number(fd.get('cost'))*100,reason:String(fd.get('reason'))});list.reload();
   }}><div className="form-grid">
    <Select name="ingredient_id" label="วัตถุดิบในล็อต" required><option value="">เลือกวัตถุดิบ</option>{ingredients.data?.ingredients.map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</Select>
    <Input label="จำนวนรับเข้าตามหน่วยฐาน" name="qty" type="number" min="0.001" max="1000000" step="0.001" required/>
    <Input label="รหัสล็อต / เอกสารรับเข้า" name="code" required maxLength={120}/>
    <Input label="วันหมดอายุ (เว้นว่างหากไม่ทราบ)" name="expires_on" type="date"/>
    <CheckField label="ยืนยันว่าไม่มีวันหมดอายุ (เช่น ภาชนะ ไม่ใช่ไม่ทราบวัน)" name="no_expiry"/><Input label="ต้นทุนต่อหน่วยฐาน (บาท เช่น บาทต่อ g/ml/ชิ้น)" name="cost" type="number" min="0" max="1000000" step="0.000001"/>
   </div><Textarea label="เหตุผลรับล็อต" name="reason" required className="resize-none"/><Submit>รับล็อตเข้าสต็อก</Submit></Form>
  </details>
  <QueryState {...list} retry={list.reload}/>
  {list.data&&<><div className="table-scroll" tabIndex={0} role="region" aria-label="ล็อตวัตถุดิบ"><table><caption>ล็อตที่ยังมียอดคงเหลือ · ยอดเก่าไม่ถูกสมมติวันหมดอายุหรือต้นทุน</caption><thead><tr>{['วัตถุดิบ','ล็อต','เหลือ','หมดอายุ','ต้นทุนต่อหน่วย','จัดการ'].map(t=><th scope="col" key={t}>{t}</th>)}</tr></thead><tbody>{list.data.lots.map(l=><tr key={l.id}><th scope="row">{l.name} ({l.unit})</th><td>{l.code}{l.legacy_unknown?' · ข้อมูลล็อตไม่ครบ':''}</td><td>{number(l.remaining_qty)}</td><td>{l.expires_on?dateText(l.expires_on)+(l.expired?' · หมดอายุแล้ว':''):l.expiry_kind==='none'?'ไม่มีวันหมดอายุ':'ไม่ทราบ'}</td><td>{l.unit_cost_satang===null?'ไม่ทราบ':money(l.unit_cost_satang)}</td><td><button onClick={()=>setWaste(l)}>บันทึกของเสีย</button></td></tr>)}</tbody></table></div><div className="row"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>ก่อนหน้า</button><span>หน้า {page} · {list.data.total} ล็อต</span><button disabled={page*25>=list.data.total} onClick={()=>setPage(p=>p+1)}>ถัดไป</button></div></>}
  {list.data?.total===0&&<Notice>ยังไม่มีล็อตคงเหลือ</Notice>}
  {waste&&<Modal title={'ของเสียจากล็อต '+waste.code} onClose={()=>setWaste(null)}><Form noValidate onSave={async fd=>{await mutate('/inventory-lots/'+waste.id+'/waste','POST',{qty:Number(fd.get('qty')),reason:String(fd.get('reason'))});setWaste(null);list.reload();}}><Input label="จำนวนของเสีย" name="qty" type="number" min="0.001" max={Number(waste.remaining_qty)} step="0.001" required/><Input label="สาเหตุของเสีย" name="reason" required maxLength={120}/><Submit>บันทึกของเสียจากล็อต</Submit></Form></Modal>}
 </>;
}
