import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useLive } from "../App";
import { mutate, number, orderNo, statusLabels, useResource } from "../lib";
import { Notice, QueryState, Select } from "../ui";
import type { Kds as KdsData, OrderItem, OrderStatus } from "../types";
export default function Kds() {
  const [station, setStation] = useState("all");
  const resource = useResource<KdsData>("/kds?station=" + station);
  const live = useLive();
  const [now, setNow] = useState(Date.now());
  const [sound, setSound] = useState(false);
  const [enablingSound, setEnablingSound] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const barAlert = useRef<AudioBuffer | null>(null);
  const playing = useRef<AudioScheduledSourceNode | null>(null);
  const previous = useRef<Set<string> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(resource.reload, [live.revision, resource.reload]);
  useEffect(() => {
    previous.current = null;
  }, [station]);
  useEffect(() => {
    if (!resource.data) return;
    const ids = new Set(resource.data.orders.map((o) => o.id));
    const seen = previous.current;
    const context = audio.current;
    const newOrders = seen ? resource.data.orders.filter((o) => !seen.has(o.id)) : [];
    if (sound && context && newOrders.length) {
      const hasBarOrder = newOrders.some((o) => o.items.some((i) => i.station === "bar"));
      if (hasBarOrder && barAlert.current) {
        playing.current?.stop();
        const source = context.createBufferSource();
        source.buffer = barAlert.current;
        source.connect(context.destination);
        source.onended = () => {
          if (playing.current === source) playing.current = null;
        };
        playing.current = source;
        source.start();
      } else if (!playing.current) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.frequency.value = 880;
        gain.gain.value = 0.08;
        oscillator.start();
        oscillator.stop(context.currentTime + 0.22);
      }
    }
    previous.current = ids;
  }, [resource.data, sound]);
  useEffect(
    () => () => {
      const context = audio.current;
      audio.current = null;
      if (context) void context.close();
    },
    [],
  );
  async function toggleSound() {
    if (sound) {
      playing.current?.stop();
      playing.current = null;
      setSound(false);
      return;
    }
    setError("");
    setEnablingSound(true);
    try {
      const context = (audio.current ??= new AudioContext());
      await context.resume();
      if (!barAlert.current) {
        const response = await fetch("/sounds/order_5s.mp3");
        if (!response.ok) throw new Error("Order alert unavailable");
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (audio.current !== context) return;
        barAlert.current = buffer;
      }
      setSound(true);
    } catch {
      setError("เปิดเสียงแจ้งเตือนไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setEnablingSound(false);
    }
  }
  async function change(item: OrderItem, status: "preparing" | "ready") {
    if (busy) return;
    setBusy(item.id);
    setError("");
    try {
      await mutate("/kds/items/" + item.id + "/status", "POST", { status });
      resource.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "เปลี่ยนสถานะไม่สำเร็จ");
      resource.reload();
    } finally {
      setBusy(null);
    }
  }
  const serverNow = now + live.offset;
  return (
    <>
      <div className="toolbar">
        <p className="muted">ออเดอร์ที่ยืนยันแล้ว · เรียงเก่าสุดก่อน</p>
        <div className="row">
          <Select
            label="สถานี"
            value={station}
            onChange={(e) => setStation(e.target.value)}
          >
            <option value="all">ทุกสถานี</option>
            <option value="bar">บาร์เครื่องดื่ม</option>
            <option value="kitchen">ครัว</option>
          </Select>
          <button
            onClick={() => void toggleSound()}
            disabled={enablingSound}
            aria-pressed={sound}
          >
            {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}{" "}
            {sound ? "เปิดเสียงอยู่" : "เปิดเสียงแจ้งเตือน"}
          </button>
          <button onClick={resource.reload}>รีเฟรช</button>
        </div>
      </div>
      {!live.connected && (
        <Notice tone="warning">
          ขาดการเชื่อมต่อ · ข้อมูลอาจไม่ล่าสุด ระบบกำลังเชื่อมต่อใหม่อัตโนมัติ
        </Notice>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <QueryState {...resource} retry={resource.reload} />
      <div className="kds-board">
        {(["pending", "preparing", "ready"] as OrderStatus[]).map((status) => {
          const orders =
            resource.data?.orders
              .map((o) => ({
                ...o,
                items: o.items.filter((i) => i.status === status),
              }))
              .filter((o) => o.items.length) ?? [];
          return (
            <section key={status} className="kds-column">
              <div className="column-head">
                <h2>{statusLabels[status]}</h2>
                <span className="count">{orders.length}</span>
              </div>
              {!orders.length && (
                <div className="empty">ไม่มีออเดอร์{statusLabels[status]}</div>
              )}
              {orders.map((order) => {
                const elapsed = Math.max(
                  0,
                  Math.floor((serverNow - Date.parse(order.created_at)) / 1000),
                );
                const target = Math.max(
                  ...order.items.map((i) => i.target_prep_seconds),
                );
                const tone =
                  elapsed > target
                    ? "late"
                    : elapsed >= target * 0.8
                      ? "near"
                      : "on-time";
                return (
                  <article className={"order-card " + tone} key={order.id}>
                    <div className="row between">
                      <strong className="order-number">
                        {orderNo(order.order_no)}
                      </strong>
                      <span className="order-timer" aria-label="เวลารอ">
                        {Math.floor(elapsed / 60)}:
                        {String(elapsed % 60).padStart(2, "0")}
                      </span>
                    </div>
                    <div className="row between caption">
                      <span>
                        {order.type === "takeaway"
                          ? "กลับบ้าน"
                          : "โต๊ะ " + order.table_no}
                      </span>
                      <span>เป้าหมาย {Math.ceil(target / 60)} นาที</span>
                    </div>
                    {order.note && (
                      <p className="customer-note">หมายเหตุ: {order.note}</p>
                    )}
                    {order.items.map((item) => (
                      <div className="kds-item" key={item.id}>
                        <h3>
                          {item.qty} × {item.product_name}
                        </h3>
                        <p className="muted">
                          {item.options.map((o) => o.name).join(" / ")}
                        </p>
                        {item.note && (
                          <p className="customer-note">{item.note}</p>
                        )}
                        <details>
                          <summary>ดูสูตรและขั้นตอน</summary>
                          <ul>
                            {item.ingredients.map((i) => (
                              <li key={i.ingredient_id}>
                                {i.name}{" "}
                                <strong>
                                  {number(i.qty * item.qty, 3)} {i.unit}
                                </strong>
                              </li>
                            ))}
                          </ul>
                          <ol>
                            {item.steps.map((s, index) => (
                              <li key={index}>
                                {s.instruction}
                                {s.timer_seconds > 0 && (
                                  <span className="muted">
                                    {" "}
                                    · {s.timer_seconds} วินาที
                                  </span>
                                )}
                                {s.image_url && (
                                  <img
                                    className="recipe-image"
                                    src={s.image_url}
                                    alt={"ภาพขั้นตอน " + (index + 1)}
                                    loading="lazy"
                                  />
                                )}
                              </li>
                            ))}
                          </ol>
                        </details>
                        {item.status !== "ready" && (
                          <button
                            className="primary touch-button"
                            disabled={!!busy || !live.connected}
                            aria-busy={busy === item.id}
                            onClick={() =>
                              void change(
                                item,
                                item.status === "pending"
                                  ? "preparing"
                                  : "ready",
                              )
                            }
                          >
                            {item.status === "pending"
                              ? "เริ่มทำ"
                              : "เสร็จแล้ว"}
                          </button>
                        )}
                        {item.status === "ready" && (
                          <span className="ready-text">
                            ✓ รอแคชเชียร์ส่งมอบ
                          </span>
                        )}
                      </div>
                    ))}
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </>
  );
}
