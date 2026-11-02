import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Trash2 } from "lucide-react";
import { useAuth } from "../App";
import { HttpError, money, mutate, orderNo, useResource } from "../lib";
import {
  CheckField,
  Form,
  Input,
  Modal,
  Notice,
  Submit,
  Textarea,
  useConfirm,
} from "../ui";
import type { Catalog, Order, CartLine as Line } from "../types";
import { CartLines } from "../components/CartLines";
import { ItemEditor } from "../components/ItemEditor";
import { ProductBrowser } from "../components/ProductBrowser";
import { linePrice as price, randomId, makeCartLine } from "../menu";
interface Draft {
  lines: Line[];
  type: "dine-in" | "takeaway";
  table: string;
  note: string;
  method: "cash" | "promptpay";
  request_key: string;
  uncertain?: object;
}
const empty = (): Draft => ({
  lines: [],
  type: "takeaway",
  table: "",
  note: "",
  method: "cash",
  request_key: randomId(),
});
export default function Pos() {
  const { user } = useAuth();
  const storage = "coffee-cart:" + user.id;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storage) ?? "null");
      return saved && Array.isArray(saved.lines) && saved.request_key
        ? saved
        : empty();
    } catch {
      return empty();
    }
  });
  const resource = useResource<Catalog>("/catalog");
  const [editor, setEditor] = useState<Line | null>(null);
  const [result, setResult] = useState<Order | null>(null);
  const [sending, setSending] = useState(false);
  const confirm = useConfirm();
  useEffect(() => {
    try {
      sessionStorage.setItem(storage, JSON.stringify(draft));
    } catch {
      /* Storage may be disabled; the current in-memory order remains usable. */
    }
  }, [draft, storage]);
  function change(update: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...update }));
  }
  const total = draft.lines.reduce((sum, l) => sum + price(l) * l.qty, 0);
  const locked = sending || !!draft.uncertain;
  async function save(data: FormData) {
    if (!draft.lines.length)
      throw new Error("กรุณาเลือกเมนูอย่างน้อยหนึ่งรายการ");
    if (draft.type === "dine-in" && !draft.table.trim())
      throw new Error("กรุณาระบุโต๊ะ");
    const pay = data.get("intent") !== "hold";
    if (!draft.uncertain && pay) {
      if (draft.method === "promptpay" && !data.get("verified"))
        throw new Error("กรุณาตรวจยอดเงินเข้าบัญชีและทำเครื่องหมายยืนยันก่อน");
      if (
        !(await confirm({
          title: "ยืนยันรับชำระ " + money(total) + "?",
          description:
            "บันทึกยอดรับเงินและตัดสต็อกวัตถุดิบ กรุณาตรวจยอดที่ได้รับให้ถูกต้อง",
          label: "ยืนยันรับชำระ",
        }))
      )
        return;
    }
    const payload = draft.uncertain ?? {
      request_key: draft.request_key,
      type: draft.type,
      table_no: draft.table,
      note: draft.note,
      ...(pay ? { payment_method: draft.method } : {}),
      items: draft.lines.map((l) => ({
        product_id: l.product.id,
        qty: l.qty,
        option_ids: l.option_ids,
        note: l.note,
      })),
    };
    setSending(true);
    try {
      const response = await mutate<{ order: Order }>(
        "/orders",
        "POST",
        payload,
      );
      setResult(response.order);
      setDraft(empty());
      resource.reload();
    } catch (error) {
      if (!(error instanceof HttpError) || error.status >= 500)
        change({ uncertain: payload });
      throw error;
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="pos-layout">
      <ProductBrowser
        catalog={resource.data}
        loading={resource.loading}
        error={resource.error}
        reload={resource.reload}
        locked={locked}
        onChoose={(product) => setEditor(makeCartLine(product))}
      />
      <aside className="cart-panel">
        <div className="section-head">
          <h2>ออเดอร์ใหม่</h2>
          {draft.lines.length > 0 && (
            <button
              className="icon"
              disabled={locked}
              aria-label="ล้างออเดอร์"
              onClick={() =>
                void (async () => {
                  if (
                    await confirm({
                      title: "ล้างออเดอร์นี้?",
                      description: "นำเมนูที่เลือกทั้งหมดออกจากออเดอร์ใหม่",
                      label: "ล้างออเดอร์",
                      danger: true,
                    })
                  )
                    setDraft(empty());
                })()
              }
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>
        {draft.uncertain && (
          <Notice tone="warning">
            ยังยืนยันผลรายการไม่ได้ กรุณากดตรวจสอบและลองอีกครั้ง
            ระบบใช้เลขคำขอเดิมเพื่อป้องกันออเดอร์ซ้ำ
          </Notice>
        )}
        <Form noValidate guard={false} onSave={save}>
          <div className="segmented">
            <button
              type="button"
              disabled={locked}
              aria-pressed={draft.type === "dine-in"}
              className={draft.type === "dine-in" ? "selected" : ""}
              onClick={() => change({ type: "dine-in" })}
            >
              ทานที่ร้าน
            </button>
            <button
              type="button"
              disabled={locked}
              aria-pressed={draft.type === "takeaway"}
              className={draft.type === "takeaway" ? "selected" : ""}
              onClick={() => change({ type: "takeaway" })}
            >
              กลับบ้าน
            </button>
          </div>
          {draft.type === "dine-in" && (
            <Input
              label="โต๊ะ"
              name="table"
              value={draft.table}
              required
              maxLength={30}
              disabled={locked}
              onChange={(e) => change({ table: e.target.value })}
            />
          )}
          <CartLines
            lines={draft.lines}
            locked={locked}
            onChange={(lines) => change({ lines })}
            onEdit={setEditor}
          />
          <Textarea
            className="resize-none"
            label="หมายเหตุออเดอร์"
            name="note"
            rows={2}
            maxLength={1000}
            value={draft.note}
            disabled={locked}
            onChange={(e) => change({ note: e.target.value })}
          />
          <div className="cart-total">
            <span>รวมทั้งหมด</span>
            <strong>{money(total)}</strong>
          </div>
          <div className="segmented">
            <button
              type="button"
              disabled={locked}
              className={draft.method === "cash" ? "selected" : ""}
              aria-pressed={draft.method === "cash"}
              onClick={() => change({ method: "cash" })}
            >
              เงินสด
            </button>
            <button
              type="button"
              disabled={locked}
              className={draft.method === "promptpay" ? "selected" : ""}
              aria-pressed={draft.method === "promptpay"}
              onClick={() => change({ method: "promptpay" })}
            >
              PromptPay
            </button>
          </div>
          {draft.method === "promptpay" && (
            <CheckField
              name="verified"
              label="ตรวจสอบยอดเงินเข้าบัญชีแล้ว"
              disabled={locked}
            />
          )}
          <div className="cart-actions">
            <Submit>
              {draft.uncertain ? "ตรวจสอบและลองอีกครั้ง" : "ยืนยันและรับชำระ"}
            </Submit>
            {!draft.uncertain && (
              <button
                type="submit"
                name="intent"
                value="hold"
                disabled={!draft.lines.length || sending}
              >
                พักออเดอร์ · ยังไม่รับเงิน
              </button>
            )}
          </div>
        </Form>
      </aside>
      {editor && (
        <ItemEditor
          line={editor}
          onClose={() => setEditor(null)}
          onSave={(line) => {
            const exists = draft.lines.some((l) => l.key === line.key);
            change({
              lines: exists
                ? draft.lines.map((l) => (l.key === line.key ? line : l))
                : [...draft.lines, line],
            });
            setEditor(null);
          }}
        />
      )}
      {result && (
        <Modal
          title={"บันทึกออเดอร์ " + orderNo(result.order_no) + " แล้ว"}
          onClose={() => setResult(null)}
        >
          <Notice tone="success">
            {result.payment_status === "paid"
              ? "รับชำระและส่งเข้าหน้าจอบาร์แล้ว"
              : draft.type === "dine-in"
                ? "พักออเดอร์แล้ว ยืนยันในหน้าออเดอร์เพื่อเริ่มทำ และรับชำระหลังทานเสร็จ"
                : "พักออเดอร์แล้ว กรุณารับชำระในหน้าออเดอร์ก่อนเริ่มทำ"}
          </Notice>
          <div className="cart-total">
            <span>ยอดรวม</span>
            <strong>{money(result.total_satang)}</strong>
          </div>
          <div className="actions">
            <button onClick={() => setResult(null)}>ขายต่อ</button>
            <Link className="button primary" to={"/receipt/" + result.id}>
              ดูใบเสร็จ <ArrowRight size={17} />
            </Link>
          </div>
        </Modal>
      )}
    </div>
  );
}
