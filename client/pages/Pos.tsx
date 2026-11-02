import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Minus, Plus, Trash2 } from "lucide-react";
import { useAuth } from "../App";
import { HttpError, money, mutate, orderNo, useResource } from "../lib";
import {
  CheckField,
  Form,
  Input,
  Modal,
  Notice,
  QueryState,
  SearchBox,
  Submit,
  Textarea,
  useConfirm,
} from "../ui";
import type { Catalog, Order, Product } from "../types";
interface Line {
  key: string;
  product: Product;
  qty: number;
  option_ids: string[];
  note: string;
}
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
  request_key: crypto.randomUUID(),
});
const price = (line: Line) =>
  line.product.price_satang +
  line.product.option_groups
    .flatMap((g) => g.options)
    .filter((o) => line.option_ids.includes(o.id))
    .reduce((s, o) => s + o.extra_price_satang, 0);
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
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
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
      <section className="catalog-panel">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} />
          <button className="ghost" onClick={resource.reload}>
            โหลดเมนูใหม่
          </button>
        </div>
        <div className="tabs" aria-label="หมวดเมนู">
          <button
            className={category === "all" ? "selected" : ""}
            onClick={() => setCategory("all")}
          >
            ทั้งหมด
          </button>
          {resource.data?.categories.map((c) => (
            <button
              key={c.id}
              className={category === c.id ? "selected" : ""}
              onClick={() => setCategory(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <QueryState {...resource} retry={resource.reload} />
        <div className="product-grid">
          {resource.data?.products
            .filter(
              (p) =>
                (category === "all" || p.category_id === category) &&
                p.name.toLocaleLowerCase().includes(q.toLocaleLowerCase()),
            )
            .map((p) => (
              <button
                className="product-tile"
                key={p.id}
                disabled={!p.is_available || locked}
                onClick={() =>
                  setEditor({
                    key: crypto.randomUUID(),
                    product: p,
                    qty: 1,
                    option_ids: p.option_groups
                      .filter((g) => g.is_required)
                      .map((g) => g.options[0]!.id),
                    note: "",
                  })
                }
              >
                {p.image_url && <img src={p.image_url} alt="" loading="lazy" />}
                <strong>{p.name}</strong>
                <span>
                  {p.is_available ? money(p.price_satang) : "ปิดขายชั่วคราว"}
                </span>
              </button>
            ))}
        </div>
        {resource.data &&
          !resource.data.products.some(
            (p) =>
              (category === "all" || p.category_id === category) &&
              p.name.includes(q),
          ) && <div className="empty">ไม่พบเมนูที่ค้นหา</div>}
      </section>
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
          <div className="cart-lines">
            {!draft.lines.length && (
              <div className="empty">
                <p>ยังไม่มีเมนูในออเดอร์</p>
                <span className="caption">เลือกเมนูทางซ้ายเพื่อเริ่มขาย</span>
              </div>
            )}
            {draft.lines.map((l) => (
              <div key={l.key} className="cart-line">
                <div className="row between">
                  <strong>{l.product.name}</strong>
                  <span className="numeric">{money(price(l) * l.qty)}</span>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={locked}
                  onClick={() => setEditor(l)}
                >
                  {l.product.option_groups
                    .flatMap((g) => g.options)
                    .filter((o) => l.option_ids.includes(o.id))
                    .map((o) => o.name)
                    .join(" / ") || "เพิ่มหมายเหตุ"}
                  {l.note && " · " + l.note}
                </button>
                <div className="row between">
                  <button
                    className="ghost danger-text"
                    type="button"
                    disabled={locked}
                    onClick={() =>
                      change({
                        lines: draft.lines.filter((i) => i.key !== l.key),
                      })
                    }
                  >
                    นำออก
                  </button>
                  <div className="quantity">
                    <button
                      type="button"
                      aria-label={"ลดจำนวน " + l.product.name}
                      disabled={locked || l.qty <= 1}
                      onClick={() =>
                        change({
                          lines: draft.lines.map((i) =>
                            i.key === l.key ? { ...i, qty: i.qty - 1 } : i,
                          ),
                        })
                      }
                    >
                      <Minus size={16} />
                    </button>
                    <span>{l.qty}</span>
                    <button
                      type="button"
                      aria-label={"เพิ่มจำนวน " + l.product.name}
                      disabled={locked || l.qty >= 99}
                      onClick={() =>
                        change({
                          lines: draft.lines.map((i) =>
                            i.key === l.key ? { ...i, qty: i.qty + 1 } : i,
                          ),
                        })
                      }
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
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
function ItemEditor({
  line,
  onSave,
  onClose,
}: {
  line: Line;
  onSave: (line: Line) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(line.option_ids);
  return (
    <Modal title={line.product.name} onClose={onClose}>
      <Form
        noValidate
        guard={false}
        onSave={async (data) => {
          for (const g of line.product.option_groups)
            if (
              g.is_required &&
              !g.options.some((o) => selected.includes(o.id))
            )
              throw new Error("กรุณาเลือก " + g.name);
          onSave({
            ...line,
            qty: Number(data.get("qty")),
            note: String(data.get("note")),
            option_ids: selected,
          });
        }}
      >
        {line.product.description && (
          <p className="muted">{line.product.description}</p>
        )}
        {line.product.option_groups.map((g) => (
          <fieldset key={g.id} className="option-group">
            <legend>
              {g.name}
              {g.is_required ? " · จำเป็น" : ""}
            </legend>
            {g.options.map((o) => (
              <label className="option-row" key={o.id}>
                <input
                  name={"group-" + g.id}
                  type={g.multi_select ? "checkbox" : "radio"}
                  checked={selected.includes(o.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      g.multi_select
                        ? e.target.checked
                          ? [...ids, o.id]
                          : ids.filter((id) => id !== o.id)
                        : [
                            ...ids.filter(
                              (id) => !g.options.some((item) => item.id === id),
                            ),
                            o.id,
                          ],
                    )
                  }
                />
                <span>{o.name}</span>
                <span className="muted">
                  {o.extra_price_satang > 0
                    ? "+" + money(o.extra_price_satang)
                    : "ไม่เพิ่มราคา"}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        <Input
          label="จำนวน"
          name="qty"
          type="number"
          min={1}
          max={99}
          required
          defaultValue={line.qty}
        />
        <Textarea
          className="resize-none"
          label="หมายเหตุสำหรับเมนูนี้"
          name="note"
          maxLength={1000}
          defaultValue={line.note}
          rows={2}
        />
        <div className="actions">
          <button type="button" onClick={onClose}>
            ย้อนกลับ
          </button>
          <Submit>เพิ่ม / บันทึกเมนู</Submit>
        </div>
      </Form>
    </Modal>
  );
}
