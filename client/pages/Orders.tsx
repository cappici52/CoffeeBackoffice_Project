import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth, useLive } from "../App";
import {
  dateText,
  money,
  mutate,
  orderNo,
  statusLabels,
  useResource,
} from "../lib";
import {
  CheckField,
  Form,
  Modal,
  Notice,
  Pager,
  QueryState,
  Select,
  Submit,
  Textarea,
  useConfirm,
  useToast,
} from "../ui";
import type { Order, OrderStatus } from "../types";
export default function Orders() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const status = params.get("status") ?? "all";
  const resource = useResource<{ orders: Order[]; total: number }>(
    "/orders?page=" + page + "&status=" + status,
  );
  const [id, setId] = useState<string | null>(null);
  const live = useLive();
  useEffect(resource.reload, [resource.reload, live.revision]);
  return (
    <>
      <div className="toolbar">
        <p className="muted">รับชำระ ส่งมอบ และติดตามออเดอร์</p>
        <div className="row">
          <Select
            label="สถานะ"
            value={status}
            onChange={(e) => setParams({ status: e.target.value, page: "1" })}
          >
            <option value="all">ทุกสถานะ</option>
            {Object.entries(statusLabels).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </Select>
          <button onClick={resource.reload}>รีเฟรช</button>
        </div>
      </div>
      <QueryState
        {...resource}
        retry={resource.reload}
        empty={!resource.data?.orders.length}
      />
      {resource.data && (
        <div className="table-panel">
          <div className="table-scroll">
            <table>
              <caption className="sr-only">รายการออเดอร์</caption>
              <thead>
                <tr>
                  <th scope="col">ออเดอร์</th>
                  <th scope="col">เวลา</th>
                  <th scope="col">ประเภท</th>
                  <th scope="col">สถานะ</th>
                  <th scope="col">ชำระเงิน</th>
                  <th scope="col" className="right">
                    ยอดรวม
                  </th>
                  <th scope="col">รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {resource.data.orders.map((o) => (
                  <tr key={o.id}>
                    <th scope="row" className="numeric">
                      {orderNo(o.order_no)}
                      {o.source === "qr" && (
                        <span className="source-badge">สั่งผ่าน QR</span>
                      )}
                    </th>
                    <td>{dateText(o.created_at, true)}</td>
                    <td>
                      {o.type === "takeaway"
                        ? "กลับบ้าน"
                        : "โต๊ะ " + o.table_no}
                    </td>
                    <td>
                      <span className={"badge " + o.status}>
                        {statusLabels[o.status]}
                      </span>
                    </td>
                    <td>
                      {o.payment_status === "paid"
                        ? "รับชำระแล้ว"
                        : o.payment_status === "refunded"
                          ? "คืนเงินแล้ว"
                          : "ยังไม่รับเงิน"}
                    </td>
                    <td className="right numeric">{money(o.total_satang)}</td>
                    <td>
                      <button className="ghost" onClick={() => setId(o.id)}>
                        เปิดออเดอร์
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            page={page}
            total={resource.data.total}
            onPage={(n) => setParams({ status, page: String(n) })}
          />
        </div>
      )}
      {id && (
        <OrderDetail
          id={id}
          onClose={() => setId(null)}
          onChange={resource.reload}
        />
      )}
    </>
  );
}
function OrderDetail({
  id,
  onClose,
  onChange,
}: {
  id: string;
  onClose: () => void;
  onChange: () => void;
}) {
  const resource = useResource<{ order: Order }>("/orders/" + id);
  const { user } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [action, setAction] = useState<"pay" | "cancel" | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const o = resource.data?.order;
  async function complete() {
    if (
      !o ||
      !(await confirm({
        title: "ส่งมอบ " + orderNo(o.order_no) + " แล้ว?",
        description: "ยืนยันว่าได้ส่งมอบสินค้าครบให้ลูกค้าแล้ว",
        label: "ยืนยันส่งมอบ",
      }))
    )
      return;
    setBusy(true);
    try {
      await mutate("/orders/" + id + "/status", "POST", {
        status: "completed",
      });
      resource.reload();
      onChange();
      toast("ส่งมอบออเดอร์แล้ว");
    } catch (e) {
      setFailure(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={o ? "ออเดอร์ " + orderNo(o.order_no) : "รายละเอียดออเดอร์"}
      onClose={onClose}
      wide
    >
      <QueryState {...resource} retry={resource.reload} />
      {failure && <Notice tone="danger">{failure}</Notice>}
      {o && (
        <>
          <div className="row between">
            <span className={"badge " + o.status}>
              {statusLabels[o.status]}
            </span>
            <span className="muted">{dateText(o.created_at, true)}</span>
          </div>
          <p>
            {o.type === "takeaway"
              ? "กลับบ้าน"
              : "ทานที่ร้าน · โต๊ะ " + o.table_no}{" "}
            ·{" "}
            {o.source === "qr"
              ? "ลูกค้าสั่งผ่าน QR"
              : "ผู้รับออเดอร์ " + o.created_by_name}
          </p>
          {o.note && <p className="customer-note">{o.note}</p>}
          <ul className="detail-lines">
            {o.items.map((i) => (
              <li key={i.id}>
                <div className="row between">
                  <strong>
                    {i.qty} × {i.product_name}
                  </strong>
                  <span>{money((i.unit_price_satang ?? 0) * i.qty)}</span>
                </div>
                <span className="muted">
                  {i.options.map((v) => v.name).join(" / ")} {i.note}
                </span>
                <span className="caption">
                  {statusLabels[i.status as OrderStatus]}
                </span>
              </li>
            ))}
          </ul>
          <div className="cart-total">
            <span>รวมทั้งหมด</span>
            <strong>{money(o.total_satang)}</strong>
          </div>
          <p>
            {o.payment_status === "paid"
              ? "รับชำระแล้ว · " +
                (o.payment_method === "cash" ? "เงินสด" : "PromptPay")
              : o.payment_status === "refunded"
                ? "คืนเงินแล้ว"
                : "ยังไม่รับชำระ"}
          </p>
          {o.cancel_reason && (
            <Notice tone="warning">เหตุผลยกเลิก: {o.cancel_reason}</Notice>
          )}
          {!action && (
            <div className="actions wrap">
              <Link className="button" to={"/receipt/" + id}>
                ใบเสร็จ
              </Link>
              {!o.payment_status && o.status === "pending" && (
                <button className="primary" onClick={() => setAction("pay")}>
                  รับชำระ
                </button>
              )}
              {o.status === "ready" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void complete()}
                >
                  ส่งมอบให้ลูกค้าแล้ว
                </button>
              )}
              {!["completed", "cancelled"].includes(o.status) &&
                (!o.payment_status ||
                  ["owner", "manager"].includes(user.role)) && (
                  <button
                    className="danger-text ghost"
                    onClick={() => setAction("cancel")}
                  >
                    ยกเลิกออเดอร์
                  </button>
                )}
            </div>
          )}
          {action && (
            <Form
              noValidate
              onSave={async (data) => {
                if (action === "pay") {
                  await mutate("/orders/" + id + "/pay", "POST", {
                    method: String(data.get("method")),
                  });
                  toast("รับชำระแล้ว");
                } else {
                  await mutate("/orders/" + id + "/status", "POST", {
                    status: "cancelled",
                    reason: String(data.get("reason")),
                    confirm_refund: !!data.get("refund"),
                  });
                  toast("ยกเลิกออเดอร์แล้ว");
                }
                setAction(null);
                resource.reload();
                onChange();
              }}
            >
              {action === "pay" ? (
                <>
                  <Select label="วิธีรับชำระ" name="method">
                    <option value="cash">เงินสด</option>
                    <option value="promptpay">PromptPay</option>
                  </Select>
                  <CheckField
                    name="verified"
                    label={
                      "ตรวจสอบว่าได้รับเงิน " + money(o.total_satang) + " แล้ว"
                    }
                    required
                  />
                </>
              ) : (
                <>
                  <Textarea
                    className="resize-none"
                    label="เหตุผลยกเลิก"
                    name="reason"
                    required
                    maxLength={1000}
                  />
                  {o.source === "qr" && (
                    <p className="caption muted">
                      เหตุผลนี้จะแสดงให้ลูกค้าเห็นในหน้าติดตามออเดอร์
                    </p>
                  )}
                  {o.payment_status === "paid" && (
                    <>
                      <Notice tone="warning">
                        เป็นการบันทึกคืนเงินด้วยพนักงาน
                        ระบบไม่ได้โอนเงินคืนอัตโนมัติ
                        วัตถุดิบจะคืนสต็อกเฉพาะออเดอร์ที่ยังไม่เริ่มทำ
                      </Notice>
                      <CheckField
                        name="refund"
                        required
                        label={
                          "ยืนยันคืนเงินลูกค้าแล้ว " + money(o.total_satang)
                        }
                      />
                    </>
                  )}
                </>
              )}
              <div className="actions">
                <button type="button" onClick={() => setAction(null)}>
                  ย้อนกลับ
                </button>
                <Submit>
                  {action === "pay" ? "ยืนยันรับชำระ" : "ยืนยันยกเลิกออเดอร์"}
                </Submit>
              </div>
            </Form>
          )}
        </>
      )}
    </Modal>
  );
}
