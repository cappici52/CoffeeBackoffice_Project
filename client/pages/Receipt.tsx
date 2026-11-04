import { Link, useParams,useSearchParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { dateText, money, orderNo, useResource } from "../lib";
import { Notice, QueryState,Select } from "../ui";
import type { Order } from "../types";
export default function Receipt() {
  const { id } = useParams();
  const [params,setParams]=useSearchParams(),paper=params.get('paper')==='58'?'58':'80';
  const resource = useResource<{ order: Order }>("/orders/" + id);
  const o = resource.data?.order;
  return (
    <>
      <div className="toolbar no-print">
        <Link className="button" to="/orders">
          กลับหน้าออเดอร์
        </Link>
        <Select label="กระดาษใบเสร็จ" value={paper} onChange={e=>setParams({paper:e.target.value})}><option value="58">58 mm</option><option value="80">80 mm</option></Select>
        <Link className="button" to={'/printer-test?paper='+paper}>ทดสอบเครื่องพิมพ์</Link>
        <button
          className="primary"
          disabled={!o}
          onClick={() => window.print()}
        >
          <Printer size={18} />
          พิมพ์ใบเสร็จ
        </button>
      </div>
      <QueryState {...resource} retry={resource.reload} />
      {o && (
        <article className="receipt" data-paper={paper}>
          <h2>Coffee Backoffice</h2>
          <p>
            {o.payment_status === "paid"
              ? "ใบเสร็จรับเงิน"
              : o.payment_status === "refunded"
                ? "รายการยกเลิก / คืนเงิน"
                : "ใบสรุปออเดอร์ · ยังไม่ชำระ"}
          </p>
          <strong className="order-number">{orderNo(o.order_no)}</strong>
          <p>{dateText(o.created_at, true)}</p>
          <p>{o.type === "takeaway" ? "กลับบ้าน" : "โต๊ะ " + o.table_no}</p>
          {o.payment_status === "refunded" && (
            <Notice tone="warning">ยกเลิกและบันทึกคืนเงินแล้ว</Notice>
          )}
          <ul className="detail-lines">
            {o.items.map((i) => (
              <li key={i.id}>
                <div className="row between">
                  <span>
                    {i.qty} × {i.product_name}
                  </span>
                  <span>{money((i.unit_price_satang ?? 0) * i.qty)}</span>
                </div>
                <small>
                  {i.options.map((v) => v.name).join(" / ")} {i.note}
                </small>
              </li>
            ))}
          </ul>
          <div className="cart-total">
            <span>รวม</span>
            <strong>{money(o.total_satang)}</strong>
          </div>
          <p>
            {o.payment_status === "paid"
              ? "รับชำระ " +
                (o.payment_method === "cash" ? "เงินสด" : "PromptPay")
              : "สถานะ: " +
                (o.payment_status === "refunded"
                  ? "คืนเงินแล้ว"
                  : "ยังไม่ชำระ")}
          </p>
          <p>
            {o.source === "qr"
              ? "ลูกค้าสั่งผ่าน QR ประจำโต๊ะ"
              : "พนักงาน: " + o.created_by_name}
          </p>
          {o.note && <p>หมายเหตุ: {o.note}</p>}
          <p className="muted">ขอบคุณที่ใช้บริการ</p>
          <small>ใบเสร็จรับเงินทั่วไป · ไม่ใช่ใบกำกับภาษี</small>
        </article>
      )}
    </>
  );
}
