import { Link,useSearchParams } from 'react-router-dom';
import { Select,Notice } from '../ui';
export default function PrinterTest(){
 const [params,setParams]=useSearchParams(),paper=params.get('paper')==='58'?'58':'80';
 return <>
  <div className="toolbar no-print"><Link className="button" to="/orders">กลับหน้าออเดอร์</Link><Select label="ความกว้างกระดาษทดสอบ" value={paper} onChange={e=>setParams({paper:e.target.value})}><option value="58">58 mm</option><option value="80">80 mm</option></Select><button className="primary" onClick={()=>window.print()}>พิมพ์หน้าทดสอบ</button></div>
  <div className="no-print"><Notice>หน้านี้ไม่สร้างออเดอร์หรือรับเงิน · เลือกขนาดกระดาษเดียวกันในไดรเวอร์ ปิดหัว/ท้ายกระดาษของ browser และใช้สเกล 100% · ยังไม่ยืนยันผลกับเครื่องพิมพ์จริง</Notice></div>
  <article className="receipt" data-paper={paper}><h2>Coffee Backoffice</h2><strong>ทดสอบเครื่องพิมพ์ {paper} mm</strong><p>ไม่ใช่ใบเสร็จรับเงิน</p><p>ภาษาไทย: กาแฟ น้ำผึ้ง ชาเขียว<br/>สระและวรรณยุกต์: กิ กี กึ กื กุ กู ก่ ก้ ก๊ ก๋</p><p>English 0123456789<br/>฿ 0.00 · 1,234.50 · + − / %</p><div className="detail-lines"><div className="row between"><span>รายการทดสอบ × 1</span><strong>฿0.00</strong></div><div className="row between"><span>รวมทดสอบ</span><strong>฿0.00</strong></div></div><p>ตรวจขอบซ้าย/ขวา ไม่ตัดข้อความ<br/>ตรวจตัวอักษรและยอดเงินตรงกัน</p><small>บันทึกรุ่นเครื่อง ไดรเวอร์ กระดาษ และผลจริงตามคู่มืออุปกรณ์</small></article>
 </>;
}
