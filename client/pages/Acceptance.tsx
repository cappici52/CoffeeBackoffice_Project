import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Form,Input,Select,Textarea,Submit,Notice } from '../ui';
const scenarios=[['pos','แคชเชียร์ · ขายและรับเงิน'],['kds','ครัว · รับงาน ทำ และส่งมอบ'],['qr','ลูกค้า · QR และติดตาม'],['inventory','ผู้จัดการ · ตรวจนับ รับของ และล็อต'],['transfer','ผู้จัดการ · โอนสาขา'],['report','เจ้าของ · ต้นทุนและรายงาน'],['forecast','เจ้าของ · ตีความพยากรณ์'],['printer','อุปกรณ์ · พิมพ์ใบเสร็จ']];
export default function Acceptance(){
 const [saved,setSaved]=useState(false);
 return <>
  <div className="section-head"><h2>บันทึกผลทดสอบกับผู้ใช้ / อุปกรณ์</h2><Link className="button" to="/printer-test">หน้าทดสอบเครื่องพิมพ์</Link></div>
  <Notice>แบบบันทึกนี้ไม่ใช่ผล automated tests · กรอกตามการทดลองจริงเท่านั้น หากไม่มีผู้ทดลองหรืออุปกรณ์ ให้คงสถานะยังไม่ทดสอบ</Notice>
  <Form noValidate onSave={async fd=>{
   const result=String(fd.get('result')),scenario=String(fd.get('scenario')),participant=String(fd.get('participant')).trim(),actual=String(fd.get('actual')).trim(),device=String(fd.get('device')).trim();
   if(result!=='not_run'&&(!participant||!actual))throw Error('ผลที่ทดสอบแล้วต้องมีรหัสผู้ทดลองและข้อสังเกตจริง');
   if(result!=='not_run'&&scenario==='printer'&&!device)throw Error('กรุณาระบุรุ่นเครื่องพิมพ์และอุปกรณ์ที่ทดสอบจริง');
   const report={recorded_at:new Date().toISOString(),scenario,result,participant_code:participant,device,actual_observations:actual,duration_minutes:fd.get('duration')?Number(fd.get('duration')):null,build_reference:String(fd.get('build')),evidence_reference:String(fd.get('evidence')),evidence_kind:'MANUALLY_REPORTED_NOT_AUTOMATED_VALIDATION'};
   const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='acceptance-'+scenario+'-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setSaved(true);
  }}>
   <div className="form-grid"><Select label="งานที่ทดลอง" name="scenario" required>{scenarios.map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select><Select label="ผลการทดลอง" name="result" defaultValue="not_run"><option value="not_run">ยังไม่ทดสอบ</option><option value="pass">ทดลองจริงแล้วผ่าน</option><option value="fail">ทดลองจริงแล้วพบปัญหา</option></Select><Input label="รหัสผู้ทดลอง (ไม่ใช้ชื่อจริงหรือรหัสผ่าน)" name="participant" maxLength={120}/><Input label="อุปกรณ์ / รุ่นเครื่องพิมพ์ / browser" name="device" maxLength={300}/><Input label="ระยะเวลาทดลอง (นาที)" name="duration" type="number" min="0" max="10000" step="0.1"/><Input label="เวอร์ชัน / commit ที่ทดลอง" name="build" maxLength={120}/><Input label="ชื่อไฟล์หลักฐาน / หมายเลขปัญหา" name="evidence" maxLength={300}/></div>
   <Textarea label="สิ่งที่เกิดขึ้นจริง ปัญหา และการช่วยเหลือที่ต้องใช้" name="actual" maxLength={5000} className="resize-none"/>
   <Submit>ดาวน์โหลดบันทึกผลทดสอบ</Submit>
  </Form>
  {saved&&<p role="status">สร้างไฟล์บันทึกแล้ว · เก็บไฟล์ไว้ในที่ส่วนตัว ไม่มีการบันทึกข้อมูลผู้ทดลองลงฐานร้าน</p>}
 </>;
}
