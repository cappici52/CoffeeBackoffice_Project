import { useState } from 'react';
import { Form,Input,Textarea,Submit,Select,QueryState,useConfirm } from '../ui';
import { useResource,mutate,number,dateText } from '../lib';

export default function Stocktakes(){
 const [id,setId]=useState('');const confirm=useConfirm();
 const stock=useResource<{ingredients:{id:string;name:string;unit:string;current_stock:string;version:number;counted_at:string|null}[]}>('/ingredient-catalog');
 const list=useResource<{stocktakes:{id:string;status:string;created_at:string;note:string}[]}>('/stocktakes');
 const detail=useResource<{stocktake:{id:string;status:string;note:string};lines:{ingredient_id:string;name:string;unit:string;counted_qty:string;system_qty:string}[]}>(id?'/stocktakes/'+id:null);
 return <>
  <p className="caption muted">กรอกเฉพาะจำนวนที่นับจริง ช่องว่างไม่ปรับยอด · ยอดเดิมยังรอตรวจนับจนยืนยันเอกสาร</p>
  <QueryState {...stock} retry={stock.reload}/>
  {stock.data&&<Form noValidate onSave={async fd=>{
   const lines=stock.data!.ingredients.filter(i=>String(fd.get('count_'+i.id)??'').trim()!=='').map(i=>({ingredient_id:i.id,counted_qty:Number(fd.get('count_'+i.id)),expected_version:i.version}));
   const saved=await mutate<{id:string}>('/stocktakes','POST',{note:String(fd.get('note')),lines});setId(saved.id);list.reload();
  }}>
   <div className="form-grid">{stock.data.ingredients.map(i=><Input key={i.id} label={`${i.name} (${i.unit}) · ระบบ ${number(i.current_stock)} · ${i.counted_at?'นับแล้ว '+dateText(i.counted_at):'รอตรวจนับ'}`} name={'count_'+i.id} type="number" min="0" max="100000000" step="0.001" />)}</div>
   <Textarea label="เหตุผล / บันทึกการตรวจนับ" name="note" required maxLength={1000} className="resize-none"/>
   <Submit>บันทึกใบตรวจนับฉบับร่าง</Submit>
  </Form>}
  <QueryState {...list} retry={list.reload}/>
  <Select label="ใบตรวจนับ" value={id} onChange={e=>setId(e.target.value)}><option value="">เลือกใบตรวจนับ</option>{list.data?.stocktakes.map(s=><option key={s.id} value={s.id}>{dateText(s.created_at,true)} · {s.status==='committed'?'ยืนยันแล้ว':'ฉบับร่าง'} · {s.note}</option>)}</Select>
  <QueryState {...detail} retry={detail.reload}/>
  {detail.data&&<>
   <div className="table-scroll" tabIndex={0} role="region" aria-label="รายละเอียดใบตรวจนับ"><table><caption>{detail.data.stocktake.note}</caption><thead><tr><th scope="col">วัตถุดิบ</th><th scope="col">ระบบเมื่อเริ่มนับ</th><th scope="col">นับจริง</th><th scope="col">ผลต่าง</th></tr></thead><tbody>{detail.data.lines.map(l=><tr key={l.ingredient_id}><th scope="row">{l.name} ({l.unit})</th><td>{number(l.system_qty)}</td><td>{number(l.counted_qty)}</td><td>{number(Number(l.counted_qty)-Number(l.system_qty))}</td></tr>)}</tbody></table></div>
   {detail.data.stocktake.status==='draft'&&<Form noValidate guard={false} onSave={async()=>{
    if(!await confirm({title:'ยืนยันยอดตรวจนับ?',description:'ปรับสต็อกตามจำนวนที่นับจริง หากมีการเคลื่อนไหวระหว่างนับ ระบบจะปฏิเสธเพื่อให้นับใหม่',label:'ยืนยันและปรับยอด'}))return;
    await mutate('/stocktakes/'+id+'/commit','POST',{});detail.reload();stock.reload();list.reload();
   }}><Submit>ยืนยันยอดนับและปรับสต็อก</Submit></Form>}
  </>}
 </>;
}
