import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { ArrowLeft, Check, Coffee, ShoppingBag } from "lucide-react";
import {
  api,
  dateText,
  HttpError,
  money,
  mutate,
  orderNo,
  useResource,
} from "../lib";
import {
  linePrice,
  makeCartLine,
  randomId,
  randomToken,
  tableLabel,
} from "../menu";
import { CartLines } from "../components/CartLines";
import { ItemEditor } from "../components/ItemEditor";
import { ProductBrowser } from "../components/ProductBrowser";
import { Form, Notice, QueryState, Submit, Textarea, useConfirm } from "../ui";
import type { CartLine, GuestOrder, MenuCatalog } from "../types";

interface GuestPayload {
  request_key: string;
  tracking_token: string;
  expected_total_satang: number;
  note: string;
  items: {
    product_id: string;
    qty: number;
    option_ids: string[];
    note: string;
  }[];
}
interface Draft {
  lines: CartLine[];
  note: string;
  request_key: string;
  tracking_token: string;
  uncertain?: GuestPayload;
}
interface History {
  token: string;
  order_no: number | string;
  created_at: string;
}
const empty = (): Draft => ({
  lines: [],
  note: "",
  request_key: randomId(),
  tracking_token: randomToken(),
});
const validToken = (value: string | undefined) =>
  !!value && /^[a-f0-9]{64}$/.test(value);
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Keep the current in-memory draft if browser storage is disabled. */
  }
}
function Shell({
  table,
  children,
  action,
}: {
  table?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="customer-shell">
      <a className="skip" href="#customer-content">
        ข้ามไปเมนู
      </a>
      <header className="customer-header">
        <div className="customer-brand">
          <Coffee size={23} aria-hidden="true" />
          <span>
            Coffee <strong>Backoffice</strong>
          </span>
        </div>
        <div className="row">
          {table && <span className="table-marker">{tableLabel(table)}</span>}
          {action}
        </div>
      </header>
      <main id="customer-content" className="customer-main">
        {children}
      </main>
      <footer className="customer-footer">
        Coffee Backoffice · สั่งอาหารและติดตามออเดอร์
      </footer>
    </div>
  );
}
function InvalidLink({ tracking = false }: { tracking?: boolean }) {
  return (
    <Shell>
      <Notice tone="warning">
        {tracking
          ? "ลิงก์ติดตามออเดอร์ไม่ถูกต้อง กรุณาเปิดลิงก์ที่ได้รับหลังสั่งอาหาร"
          : "QR นี้ไม่ถูกต้อง กรุณาสแกน QR ที่โต๊ะอีกครั้งหรือติดต่อพนักงาน"}
      </Notice>
    </Shell>
  );
}
function Menu() {
  const { token } = useParams();
  if (!validToken(token)) return <InvalidLink />;
  return <MenuPage key={token} token={token!} />;
}
function MenuPage({ token }: { token: string }) {
  const resource = useResource<MenuCatalog & { table: { name: string } }>(
    "/guest/tables/" + token,
  );
  const key = "guest-cart:" + token;
  const [draft, setDraft] = useState<Draft>(() => {
    const saved = read<Draft | null>(key, null);
    return saved &&
      Array.isArray(saved.lines) &&
      validToken(saved.tracking_token) &&
      saved.request_key
      ? saved
      : empty();
  });
  const [editor, setEditor] = useState<CartLine | null>(null);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<History[]>(() => {
    const saved = read<History[]>("guest-history:" + token, []);
    return Array.isArray(saved)
      ? saved
          .filter((h) => h && validToken(h.token) && h.order_no && h.created_at)
          .slice(0, 20)
      : [];
  });
  const [cartVisible, setCartVisible] = useState(false);
  const cart = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const confirm = useConfirm();
  useEffect(() => store(key, draft), [key, draft]);
  useEffect(() => {
    document.title =
      (resource.data ? tableLabel(resource.data.table.name) + " · " : "") +
      "เมนู · Coffee Backoffice";
  }, [resource.data]);
  useEffect(() => {
    if (!cart.current) return;
    const observer = new IntersectionObserver((entries) =>
      setCartVisible(!!entries[0]?.isIntersecting),
    );
    observer.observe(cart.current);
    return () => observer.disconnect();
  }, [resource.data]);
  const total = draft.lines.reduce(
    (sum, line) => sum + linePrice(line) * line.qty,
    0,
  );
  const locked = sending || !!draft.uncertain;
  function change(update: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...update }));
  }
  function accepted(order: GuestOrder, tracking: string) {
    const next = [
      {
        token: tracking,
        order_no: order.order_no,
        created_at: order.created_at,
      },
      ...history.filter((h) => h.token !== tracking),
    ].slice(0, 20);
    setHistory(next);
    store("guest-history:" + token, next);
    store("guest-table:" + tracking, token);
    const fresh = empty();
    store(key, fresh);
    setDraft(fresh);
    navigate("/track/" + tracking);
  }
  async function send() {
    if (!draft.lines.length)
      throw new Error("กรุณาเลือกเมนูอย่างน้อยหนึ่งรายการ");
    if (draft.lines.length > 20)
      throw new Error("สั่งได้ไม่เกิน 20 รายการต่อออเดอร์");
    if (
      !draft.uncertain &&
      !(await confirm({
        title: "ยืนยันสั่งอาหาร " + money(total) + "?",
        description:
          "ออเดอร์จะส่งถึงพนักงาน กรุณาชำระเงินที่เคาน์เตอร์ก่อนเริ่มทำ",
        label: "ยืนยันสั่งอาหาร",
      }))
    )
      return;
    const payload: GuestPayload = draft.uncertain ?? {
      request_key: draft.request_key,
      tracking_token: draft.tracking_token,
      expected_total_satang: total,
      note: draft.note,
      items: draft.lines.map((line) => ({
        product_id: line.product.id,
        qty: line.qty,
        option_ids: line.option_ids,
        note: line.note,
      })),
    };
    setSending(true);
    try {
      if (draft.uncertain) {
        try {
          const result = await api<{ order: GuestOrder }>(
            "/guest/orders/" + payload.tracking_token,
          );
          accepted(result.order, payload.tracking_token);
          return;
        } catch (error) {
          if (!(error instanceof HttpError) || error.status !== 404)
            throw error;
        }
      }
      const result = await mutate<{ order: GuestOrder }>(
        "/guest/tables/" + token + "/orders",
        "POST",
        payload,
      );
      accepted(result.order, payload.tracking_token);
    } catch (error) {
      if (!(error instanceof HttpError) || error.status >= 500)
        change({ uncertain: payload });
      if (error instanceof HttpError && error.code === "DAY_ALREADY_CLOSED")
        throw new Error("ร้านปิดรับออเดอร์สำหรับวันนี้แล้ว กรุณาติดต่อพนักงาน");
      throw error;
    } finally {
      setSending(false);
    }
  }
  return (
    <Shell
      table={resource.data?.table.name}
      action={
        <button
          className="icon"
          aria-label={"ดูตะกร้า " + draft.lines.length + " รายการ"}
          onClick={() =>
            cart.current?.scrollIntoView({
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
            })
          }
        >
          <ShoppingBag size={20} />
          <span>{draft.lines.length}</span>
        </button>
      }
    >
      <div className="customer-intro">
        <h1>เลือกเมนูที่ชอบ</h1>
        <p className="muted">
          เลือกเมนูและตัวเลือก แล้วส่งออเดอร์ให้พนักงาน · ชำระเงินที่เคาน์เตอร์
        </p>
      </div>
      {resource.error && (
        <Notice tone="warning">
          {resource.error} หาก QR เปิดไม่ได้ กรุณาติดต่อพนักงาน
        </Notice>
      )}
      <div className="customer-order-layout">
        <ProductBrowser
          catalog={resource.data}
          loading={resource.loading}
          error={null}
          reload={resource.reload}
          locked={locked || draft.lines.length >= 20}
          onChoose={(product) => setEditor(makeCartLine(product))}
        />
        <section
          ref={cart}
          id="guest-cart"
          className="cart-panel customer-cart"
        >
          <div className="section-head">
            <h2>ตะกร้าของคุณ</h2>
            {draft.lines.length > 0 && (
              <button
                className="ghost danger-text"
                disabled={locked}
                onClick={() =>
                  void (async () => {
                    if (
                      await confirm({
                        title: "ล้างตะกร้า?",
                        description: "นำเมนูที่เลือกทั้งหมดออกจากคำสั่งซื้อนี้",
                        label: "ล้างตะกร้า",
                        danger: true,
                      })
                    )
                      setDraft(empty());
                  })()
                }
              >
                ล้าง
              </button>
            )}
          </div>
          {draft.uncertain && (
            <Notice tone="warning">
              ยังยืนยันผลการส่งไม่ได้ กรุณากดตรวจสอบคำสั่งซื้อ
              ระบบจะตรวจออเดอร์เดิมก่อนส่งซ้ำ
            </Notice>
          )}
          <Form noValidate guard={false} onSave={send}>
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
              maxLength={1000}
              rows={2}
              disabled={locked}
              value={draft.note}
              onChange={(e) => change({ note: e.target.value })}
            />
            <div className="cart-total">
              <span>รวมทั้งหมด</span>
              <strong>{money(total)}</strong>
            </div>
            <p className="caption muted">
              ยังไม่มีการเรียกเก็บเงินออนไลน์ พนักงานจะรับชำระและส่งเข้าคิวทำ
            </p>
            <div className="cart-actions">
              <Submit>
                {draft.uncertain ? "ตรวจสอบคำสั่งซื้อ" : "ส่งออเดอร์"}
              </Submit>
            </div>
          </Form>
        </section>
      </div>
      {history.length > 0 && (
        <section id="my-orders" className="customer-history">
          <h2>ออเดอร์ของคุณบนอุปกรณ์นี้</h2>
          <ul>
            {history.map((h) => (
              <li key={h.token}>
                <Link to={"/track/" + h.token}>
                  {orderNo(h.order_no)}{" "}
                  <span>{dateText(h.created_at, true)}</span>
                  <strong>ติดตามสถานะ →</strong>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {draft.lines.length > 0 && !cartVisible && (
        <button
          className="customer-cart-jump primary"
          onClick={() =>
            cart.current?.scrollIntoView({
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
            })
          }
        >
          <ShoppingBag size={19} />
          ดูตะกร้า · {draft.lines.reduce((sum, l) => sum + l.qty, 0)} รายการ
          <span>{money(total)}</span>
        </button>
      )}
      {editor && (
        <ItemEditor
          line={editor}
          submitLabel="เพิ่มลงตะกร้า"
          onClose={() => setEditor(null)}
          onSave={(line) => {
            change({
              lines: draft.lines.some((l) => l.key === line.key)
                ? draft.lines.map((l) => (l.key === line.key ? line : l))
                : [...draft.lines, line],
            });
            setEditor(null);
          }}
        />
      )}
    </Shell>
  );
}
const stages = [
  {
    title: "รอยืนยัน / ชำระเงิน",
    description: "กรุณาชำระเงินที่เคาน์เตอร์ พนักงานจะยืนยันก่อนเริ่มทำ",
  },
  { title: "รอทำ", description: "รับชำระแล้ว ออเดอร์ของคุณอยู่ในคิว" },
  { title: "กำลังทำ", description: "พนักงานกำลังเตรียมเมนูของคุณ" },
  { title: "รอเสิร์ฟ", description: "เตรียมเสร็จแล้ว กำลังรอพนักงานส่งมอบ" },
  { title: "เสิร์ฟแล้ว", description: "ส่งมอบครบแล้ว ขอบคุณที่ใช้บริการ" },
];
function Tracking() {
  const { token } = useParams();
  if (!validToken(token)) return <InvalidLink tracking />;
  return <TrackingPage token={token!} />;
}
function TrackingPage({ token }: { token: string }) {
  const resource = useResource<{ order: GuestOrder }>("/guest/orders/" + token);
  const order = resource.data?.order;
  const tableToken = read<string | null>("guest-table:" + token, null);
  const terminal =
    order?.status === "completed" || order?.status === "cancelled";
  useEffect(() => {
    document.title =
      (order ? orderNo(order.order_no) + " · " : "") +
      "ติดตามออเดอร์ · Coffee Backoffice";
  }, [order?.order_no]);
  useEffect(() => {
    if (terminal) return;
    const refresh = () => {
      if (document.visibilityState === "visible") resource.reload();
    };
    const timer = setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [terminal, resource.reload]);
  const index = !order?.payment_status
    ? 0
    : order?.status === "completed"
      ? 4
      : order?.status === "ready"
        ? 3
        : order?.status === "preparing"
          ? 2
          : 1;
  const current = stages[index]!;
  return (
    <Shell table={order?.table_no}>
      <div className="customer-tracking">
        <div className="toolbar">
          <div>
            <h1>ติดตามออเดอร์</h1>
            <p className="muted">อัปเดตสถานะอัตโนมัติ · เฉพาะออเดอร์ของคุณ</p>
          </div>
          <button onClick={resource.reload}>อัปเดตสถานะ</button>
        </div>
        <QueryState
          {...resource}
          loading={resource.loading && !resource.data}
          retry={resource.reload}
        />
        {order && (
          <>
            <section className="guest-status-panel">
              <div className="row between">
                <strong className="order-number">
                  {orderNo(order.order_no)}
                </strong>
                <time className="muted caption">
                  {dateText(order.created_at, true)}
                </time>
              </div>
              {order.status === "cancelled" ? (
                <>
                  <h2 className="danger-text">ออเดอร์ถูกยกเลิก</h2>
                  <Notice tone="warning">
                    {order.cancel_reason || "กรุณาสอบถามพนักงาน"}
                    {order.payment_status === "refunded" &&
                      " · พนักงานบันทึกคืนเงินแล้ว"}
                  </Notice>
                </>
              ) : (
                <>
                  <h2 className="guest-current-status" aria-live="polite">
                    {current.title}
                  </h2>
                  <p className="muted">{current.description}</p>
                  <ol className="guest-progress" aria-label="ขั้นตอนออเดอร์">
                    {stages.map((s, i) => (
                      <li
                        key={s.title}
                        className={
                          i < index ? "done" : i === index ? "current" : ""
                        }
                        aria-current={i === index ? "step" : undefined}
                      >
                        <span className="progress-dot" aria-hidden="true">
                          {i < index ? <Check size={15} /> : i + 1}
                        </span>
                        <span>{s.title}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </section>
            <section className="guest-order-detail">
              <h2>รายการที่สั่ง</h2>
              <ul className="detail-lines">
                {order.items.map((item) => (
                  <li key={item.id}>
                    <div className="row between">
                      <strong>
                        {item.qty} × {item.product_name}
                      </strong>
                      <span>{money(item.unit_price_satang * item.qty)}</span>
                    </div>
                    <span className="muted">
                      {item.options.map((o) => o.name).join(" / ")}
                    </span>
                    {item.note && <p className="customer-note">{item.note}</p>}
                    <small>
                      {item.status === "completed"
                        ? "เสิร์ฟแล้ว"
                        : item.status === "ready"
                          ? "พร้อมเสิร์ฟ"
                          : item.status === "preparing"
                            ? "กำลังทำ"
                            : item.status === "cancelled"
                              ? "ยกเลิก"
                              : "รอทำ"}
                    </small>
                  </li>
                ))}
              </ul>
              {order.note && (
                <p className="customer-note">หมายเหตุ: {order.note}</p>
              )}
              <div className="cart-total">
                <span>รวมทั้งหมด</span>
                <strong>{money(order.total_satang)}</strong>
              </div>
              <p className="caption muted">
                {order.payment_status === "paid"
                  ? "รับชำระแล้ว"
                  : order.payment_status === "refunded"
                    ? "พนักงานบันทึกคืนเงินแล้ว"
                    : "ยังไม่รับชำระ · กรุณาชำระที่เคาน์เตอร์"}
              </p>
              <p className="caption muted">
                สถานะล่าสุด {dateText(order.server_time, true)}
              </p>
            </section>
            {tableToken && (
              <Link className="button" to={"/table/" + tableToken}>
                <ArrowLeft size={17} />
                กลับไปดูเมนู / สั่งเพิ่ม
              </Link>
            )}
            <p className="caption muted">
              เก็บลิงก์หน้านี้ไว้เพื่อติดตามออเดอร์ และไม่ส่งต่อให้ผู้อื่น
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}
export default function Customer() {
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <Routes>
      <Route path="/table/:token" element={<Menu />} />
      <Route path="/track/:token" element={<Tracking />} />
      <Route path="*" element={<InvalidLink />} />
    </Routes>
  );
}
