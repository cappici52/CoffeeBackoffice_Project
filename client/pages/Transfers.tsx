import { useState } from 'react';
import { useBranch } from '../branches';
import { Form,Select,Input,Submit,QueryState } from '../ui';
import { useResource,mutate,number,dateText } from '../lib';
export default function Transfers(){
 const branch=useBranch(),[key,setKey]=useState(()=>crypto.randomUUID());
 const stock=useResource<{ingredients:{id:string;name:string;unit:string;current_stock:string}[]}>('/ingredient-catalog');
 const list=useResource<{transfers:{id:string;source_name:string;target_name:string;name:string;unit:string;qty:string;reason:string;created_at:string}[]}>('/stock-transfers');
 return <>
  <p className="caption muted">โอนจากสาขาที่เลือกไปสาขาที่คุณมีสิทธิ์ · ตัดออกและรับเข้าพร้อมกัน พร้อมรักษาวันหมดอายุและต้นทุนล็อต · ไม่โอนล็อตหมดอายุ</p>
  <QueryState {...stock} retry={stock.reload}/>
  <Form key={key} noValidate onSave={async fd=>{
   await mutate('/stock-transfers','POST',{target_branch_id:String(fd.get('target')),ingredient_id:String(fd.get('ingredient')),qty:Number(fd.get('qty')),reason:String(fd.get('reason')),request_key:key});setKey(crypto.randomUUID());stock.reload();list.reload();
  }}><div className="form-grid">
   <Select name="target" label="สาขาปลายทาง" required><option value="">เลือกสาขาปลายทาง</option>{branch.branches.filter(b=>b.id!==branch.id&&b.is_active).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select>
   <Select name="ingredient" label="วัตถุดิบที่โอน" required><option value="">เลือกวัตถุดิบ</option>{stock.data?.ingredients.map(i=><option key={i.id} value={i.id}>{i.name} ({i.unit}) · สต็อก {number(i.current_stock)}</option>)}</Select>
   <Input label="จำนวนโอนตามหน่วยฐาน" name="qty" type="number" min="0.001" max="1000000" step="0.001" required/>
   <Input label="เหตุผลการโอน" name="reason" required maxLength={120}/>
  </div><Submit>ยืนยันโอนและรับเข้าปลายทาง</Submit></Form>
  <QueryState {...list} retry={list.reload}/>
  {list.data&&<div className="table-scroll" tabIndex={0} role="region" aria-label="ประวัติโอนระหว่างสาขา"><table><caption>ประวัติการโอน · ไม่ลบหรือแก้รายการย้อนหลัง</caption><thead><tr>{['เวลา','จากสาขา','ไปสาขา','วัตถุดิบ','จำนวน','เหตุผล'].map(t=><th scope="col" key={t}>{t}</th>)}</tr></thead><tbody>{list.data.transfers.map(t=><tr key={t.id}><td>{dateText(t.created_at,true)}</td><td>{t.source_name}</td><td>{t.target_name}</td><th scope="row">{t.name}</th><td>{number(t.qty)} {t.unit}</td><td>{t.reason}</td></tr>)}</tbody></table></div>}
 </>;
}
