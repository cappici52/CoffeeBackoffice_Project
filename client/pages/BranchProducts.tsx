import { useState } from 'react';
import { useBranch } from '../branches';
import { money,mutate,useResource } from '../lib';
import { Form,Input,Modal,Notice,QueryState,Select,Submit,usePagedRows,useToast } from '../ui';
type Product={id:string;name:string;price_satang:number;is_available:boolean;default_price_satang:number;override_price_satang:number|null;override_is_available:boolean|null;override_version:number};
export default function BranchProducts(){
 const branch=useBranch(),resource=useResource<{products:Product[]}>('/branch-products'),toast=useToast();
 const [editor,setEditor]=useState<Product|null>(null);const rows=usePagedRows(resource.data?.products??[],'branch-products');
 return <>
  <p className="muted">ราคาและการเปิดขายเฉพาะ {branch.branches.find(b=>b.id===branch.id)?.name} · สูตรใช้ร่วมกัน</p>
  <QueryState {...resource} retry={resource.reload} empty={!resource.data?.products.length}/>
  {resource.data&&<div className="table-panel"><div className="table-scroll"><table><caption className="sr-only">เมนูประจำสาขา</caption><thead><tr><th>เมนู</th><th>ราคากลาง</th><th>ราคาสาขา</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>{rows.items.map(p=><tr key={p.id}><th scope="row">{p.name}</th><td>{money(p.default_price_satang)}</td><td>{money(p.price_satang)}{p.override_price_satang===null?' · ราคากลาง':''}</td><td>{p.is_available?'เปิดขาย':'พักขาย'}</td><td><button onClick={()=>setEditor(p)}>ตั้งค่า</button></td></tr>)}</tbody></table></div>{rows.controls}</div>}
  {editor&&<Modal title={'ตั้งค่า '+editor.name} onClose={()=>setEditor(null)}><Form noValidate onSave={async data=>{
   const amount=String(data.get('price')).trim(),available=String(data.get('available'));
   await mutate('/branch-products/'+editor.id,'PUT',{price_satang:amount===''?null:Math.round(Number(amount)*100),is_available:available==='inherit'?null:available==='true',expected_version:editor.override_version});
   setEditor(null);resource.reload();toast('บันทึกเมนูประจำสาขาแล้ว');
  }}>
   <Notice>เว้นราคาว่างเพื่อใช้ราคากลาง {money(editor.default_price_satang)}</Notice>
   <Input label="ราคาสาขา (บาท)" name="price" type="number" min={0} max={100000} step="0.01" defaultValue={editor.override_price_satang===null?'':editor.override_price_satang/100}/>
   <Select label="การเปิดขาย" name="available" defaultValue={editor.override_is_available===null?'inherit':String(editor.override_is_available)}><option value="inherit">ใช้ค่ากลาง</option><option value="true">เปิดขาย</option><option value="false">พักขาย</option></Select><Submit>บันทึกเมนูสาขา</Submit>
  </Form></Modal>}
 </>;
}
