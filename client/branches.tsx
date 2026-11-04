import { createContext,useContext,useEffect,useState,type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { setApiBranch,branchMutationPending,useResource } from './lib';
import { Notice,QueryState,Select,useConfirm,useToast } from './ui';
import type { User } from './types';

export type Branch={id:string;name:string;code:string;address:string;phone:string;is_active:boolean;is_legacy:boolean;version:number};
type Context={branches:Branch[];id:string;canManage:boolean;canAggregate:boolean;refresh:()=>void;change:(id:string)=>Promise<void>};
const BranchContext=createContext<Context>(null as unknown as Context);
export const useBranch=()=>useContext(BranchContext);
export function BranchProvider({user,children,logout}:{user:User;children:ReactNode;logout:()=>Promise<void>}) {
 const resource=useResource<{branches:Branch[];can_manage:boolean;can_aggregate:boolean}>('/branches');
 const [id,setId]=useState('');const confirm=useConfirm(),toast=useToast(),navigate=useNavigate();
 const [ready,setReady]=useState(false);
 useEffect(()=>{
  if(!resource.data)return;
  const saved=id||localStorage.getItem('coffee.branch.'+user.id);
  const valid=saved==='all'?resource.data.can_aggregate:resource.data.branches.some(b=>b.id===saved&&(b.is_active||resource.data!.can_aggregate));
  const next=valid?saved!:resource.data.branches.find(b=>b.is_active)?.id??(resource.data.can_aggregate?resource.data.branches[0]?.id:'')??'';
  setApiBranch(next);setId(next);setReady(true);
 },[resource.data,user.id,id]);
 const change=async(next:string)=>{
  if(next===id)return;
  if(branchMutationPending()){toast('รอให้บันทึกรายการเสร็จก่อนเปลี่ยนสาขา');return;}
  if(!await confirm({title:'เปลี่ยนสาขา?',description:'ตะกร้าและงานที่ยังไม่บันทึกจะถูกล้าง กรุณาบันทึกงานก่อนเปลี่ยน',label:'เปลี่ยนสาขา'}))return;
  setApiBranch(next);localStorage.setItem('coffee.branch.'+user.id,next);setId(next);
  if(next==='all')navigate('/reports');
 };
 if(!resource.data)return <QueryState {...resource} retry={resource.reload}/>;
 if(!ready)return <Notice>กำลังเลือกสาขา…</Notice>;
 if(!resource.data.branches.length)return <Notice tone="warning">ยังไม่ได้รับสิทธิ์สาขา กรุณาติดต่อเจ้าของร้าน <button onClick={resource.reload}>ตรวจสอบอีกครั้ง</button><button onClick={()=>void logout().catch(e=>toast(e.message))}>ออกจากระบบ</button></Notice>;
 if(!id)return <Notice tone="warning">ไม่มีสาขาที่เปิดใช้งานสำหรับบัญชีนี้ กรุณาติดต่อเจ้าของร้าน <button onClick={resource.reload}>ตรวจสอบอีกครั้ง</button><button onClick={()=>void logout().catch(e=>toast(e.message))}>ออกจากระบบ</button></Notice>;
 return <BranchContext value={{branches:resource.data.branches,id,canManage:resource.data.can_manage,canAggregate:resource.data.can_aggregate,refresh:resource.reload,change}}>{children}</BranchContext>;
}
export function BranchSelector(){
 const branch=useBranch();
 return <div className="branch-selector"><Select label="สาขาปัจจุบัน" value={branch.id} onChange={e=>void branch.change(e.target.value)}>
  {branch.canAggregate&&<option value="all">ทุกสาขาที่มีสิทธิ์ · รายงานรวม</option>}
  {branch.branches.filter(b=>b.is_active||branch.canAggregate).map(b=><option key={b.id} value={b.id}>{b.name}{b.is_active?'':' · ปิดใช้งาน'}</option>)}
 </Select></div>;
}
