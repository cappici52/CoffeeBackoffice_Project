import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBranch,type Branch } from '../branches';
import { mutate,roleLabels,useResource } from '../lib';
import { CheckField,Form,Input,Modal,Notice,QueryState,Submit,Textarea,useConfirm,usePagedRows,useToast } from '../ui';
import type { Role } from '../types';

type Employee={id:string;name:string;role:Role;is_active:boolean;assigned:boolean};
export default function Branches(){
 const context=useBranch(),confirm=useConfirm(),toast=useToast();
 const [editor,setEditor]=useState<Branch|'new'|null>(null),[details,setDetails]=useState<Branch|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const rows=usePagedRows(context.branches,'branches');
 const employees=useResource<{employees:Employee[]}>(details?`/branches/${details.id}/employees`:null);
 async function assign(person:Employee){
  if(!details||busy)return;
  if(!await confirm({title:person.assigned?'ถอนสิทธิ์สาขา?':'มอบหมายสาขา?',description:`${person.name} · ${details.name}`,label:person.assigned?'ถอนสิทธิ์':'มอบหมาย'}))return;
  setBusy(true);setError('');
  try{await mutate(`/branches/${details.id}/employees/${person.id}`,'PUT',{assigned:!person.assigned});employees.reload();toast('บันทึกสิทธิ์สาขาแล้ว');}
  catch(e){setError(e instanceof Error?e.message:'บันทึกไม่สำเร็จ');}finally{setBusy(false);}
 }
 return <>
  <div className="toolbar"><p className="muted">จัดการสาขาและพนักงานที่รับผิดชอบ</p>{context.canManage&&<button className="primary" onClick={()=>setEditor('new')}>เพิ่มสาขา</button>}</div>
  <div className="table-panel"><div className="table-scroll"><table><caption className="sr-only">สาขาร้านกาแฟ</caption>
   <thead><tr><th>รหัส</th><th>สาขา</th><th>ที่อยู่</th><th>โทรศัพท์</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
   <tbody>{rows.items.map(b=><tr key={b.id}><td>{b.code}</td><th scope="row">{b.name}</th><td>{b.address||'—'}</td><td>{b.phone||'—'}</td><td>{b.is_active?'เปิดใช้งาน':'ปิดใช้งาน'}</td><td><div className="actions"><button onClick={()=>{setDetails(b);setError('');}}>รายละเอียด / พนักงาน</button>{context.canManage&&<button onClick={()=>setEditor(b)}>แก้ไข</button>}</div></td></tr>)}</tbody>
  </table></div>{rows.controls}</div>
  {editor&&<Modal title={editor==='new'?'เพิ่มสาขา':'แก้ไขสาขา'} onClose={()=>setEditor(null)}><Form noValidate onSave={async data=>{
   const input={name:String(data.get('name')),code:String(data.get('code')),address:String(data.get('address')),phone:String(data.get('phone')),is_active:data.get('is_active')==='on'};
   if(editor!=='new'&&input.is_active!==editor.is_active&&!await confirm({title:input.is_active?'เปิดใช้สาขา?':'ปิดใช้สาขา?',description:'เมื่อปิดใช้จะหยุดการทำรายการของสาขา แต่เก็บประวัติไว้',label:input.is_active?'เปิดใช้':'ปิดใช้'}))return;
   await mutate(editor==='new'?'/branches':'/branches/'+editor.id,editor==='new'?'POST':'PATCH',{...input,...(editor==='new'?{}:{expected_version:editor.version})});
   setEditor(null);context.refresh();toast('บันทึกสาขาแล้ว');
  }}>
   <Input label="ชื่อสาขา" name="name" required maxLength={120} defaultValue={editor==='new'?'':editor.name}/>
   <Input label="รหัสสาขา" name="code" required maxLength={30} pattern={'[A-Za-z0-9_\\-]+'} defaultValue={editor==='new'?'':editor.code}/>
   <Textarea className="resize-none" label="ที่อยู่" name="address" maxLength={1000} defaultValue={editor==='new'?'':editor.address}/>
   <Input label="โทรศัพท์" name="phone" type="tel" maxLength={50} defaultValue={editor==='new'?'':editor.phone}/>
   <CheckField name="is_active" label="เปิดใช้งานสาขา" defaultChecked={editor==='new'||editor.is_active}/><Submit>บันทึกสาขา</Submit>
  </Form></Modal>}
  {details&&<Modal title={'สาขา '+details.name} onClose={()=>setDetails(null)}>
   <p>{details.code} · {details.address||'ยังไม่ได้ระบุที่อยู่'} · {details.phone||'ยังไม่ได้ระบุโทรศัพท์'}</p>
   <button onClick={async()=>{await context.change(details.id);setDetails(null);}}>เลือกสาขานี้</button> <Link to="/reports" onClick={()=>setDetails(null)}>รายงานของสาขาที่เลือก</Link>
   {error&&<Notice tone="danger">{error}</Notice>}<QueryState {...employees} retry={employees.reload}/>
   {employees.data&&<div className="table-scroll"><table><caption>พนักงานประจำสาขา</caption><thead><tr><th>ชื่อ</th><th>หน้าที่</th><th>สิทธิ์สาขา</th></tr></thead><tbody>{employees.data.employees.map(p=><tr key={p.id}><th scope="row">{p.name}{p.is_active?'':' · ปิดบัญชี'}</th><td>{roleLabels[p.role]}</td><td>{p.role==='owner'?'ทุกสาขา':context.canManage?<button disabled={busy} onClick={()=>void assign(p)}>{p.assigned?'ถอนสิทธิ์':'มอบหมาย'}</button>:p.assigned?'มอบหมายแล้ว':'—'}</td></tr>)}</tbody></table></div>}
  </Modal>}
 </>;
}
