import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  addDays,
  api,
  dateText,
  mutate,
  number,
  today,
  useResource,
} from "../lib";
import {
  Form,
  Input,
  Notice,
  QueryState,
  Select,
  Submit,
  useToast,
  usePagedRows,
} from "../ui";
import type { Catalog, Forecasts } from "../types";
function methodLabel(version: string) {
  if (version.startsWith("coffee-xgb-")) return "XGBoost ประวัติร้าน";
  if (version.startsWith("projecta-xgb-")) return "XGBoost ProjectA";
  if (version === "weekly-naive-v1") return "ยอดสัปดาห์ก่อน";
  if (version === "mean-28-v1") return "ค่าเฉลี่ย 28 วัน";
  if (version === "mean-7-v1") return "ค่าเฉลี่ย 7 วัน";
  if (version === "weekday-mean-v1") return "ค่าเฉลี่ยวันเดียวกัน 4 สัปดาห์";
  if (version === "ses-v1") return "ปรับเรียบเอ็กซ์โพเนนเชียล";
  if (version === "damped-holt-v1") return "Holt แนวโน้มชะลอ";
  return version.startsWith("mock-") ? "โมเดลจำลองเดิม" : "ไม่ทราบวิธี";
}
export default function Forecast() {
  const [params, setParams] = useSearchParams();
  const from = params.get("from") ?? addDays(today(), -7);
  const to = params.get("to") ?? addDays(today(), 7);
  const product = params.get("product") ?? "";
  const mode = params.get("mode") === "mixed" ? "mixed" : "actual";
  const run = params.get("run") ?? "";
  const [runDraft, setRunDraft] = useState(run);
  useEffect(() => setRunDraft(run), [run]);
  const lead = params.get("lead") ?? "";
  const [days, setDays] = useState("7");
  const catalog = useResource<Catalog>("/catalog");
  const resource = useResource<Forecasts>(
    `/forecasts?date_from=${from}&date_to=${to}&data_mode=${mode}${product ? "&product_id=" + product : ""}${run ? "&run_id=" + run : ""}${lead ? "&lead_days=" + lead : ""}`,
  );
  const toast = useToast();
  const data = resource.data;
  const hasLegacy = data?.model_mode === "mock" || data?.model_mode === "mixed";
  const recommendations = usePagedRows(
    data?.recommendations ?? [],
    from + to + product,
  );
  const forecastRows = usePagedRows(data?.forecasts ?? [], from + to + product);
  const coverage = usePagedRows(data?.coverage ?? [], product + mode);
  const evaluationRows = usePagedRows(
    data?.evaluation.by_product_lead ?? [],
    from + to + product + lead,
  );
  const sourceLabel = (source: string) =>
    source === "simulation"
      ? "จำลองการขายผ่านแอปนี้"
      : source === "actual"
        ? "ข้อมูลออเดอร์ร้าน"
        : source === "demo"
          ? "ข้อมูลตัวอย่าง"
          : source === "mixed"
            ? "ข้อมูลผสม"
            : "ไม่ทราบที่มา";
  const chartMap = new Map<
    string,
    {
      date: string;
      actual?: number;
      forecast?: number;
      lower: number;
      upper: number;
      interval?: [number, number];
      hasInterval?: boolean;
    }
  >();
  for (const f of data?.forecasts ?? []) {
    const row = chartMap.get(f.date) ?? { date: f.date, lower: 0, upper: 0 };
    row.forecast = (row.forecast ?? 0) + Number(f.predicted_qty);
    row.hasInterval =
      (row.hasInterval ?? true) && f.lower_qty !== null && f.upper_qty !== null;
    if (f.lower_qty !== null && f.upper_qty !== null) {
      row.lower += Number(f.lower_qty);
      row.upper += Number(f.upper_qty);
    }
    chartMap.set(f.date, row);
  }
  for (const a of data?.actual ?? []) {
    const row = chartMap.get(a.date) ?? { date: a.date, lower: 0, upper: 0 };
    row.actual = (row.actual ?? 0) + Number(a.qty);
    chartMap.set(a.date, row);
  }
  const chart = [...chartMap.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((row) => ({
      ...row,
      ...(row.forecast !== undefined && row.hasInterval
        ? { interval: [row.lower, row.upper] as [number, number] }
        : {}),
    }));
  return (
    <>
      <Notice>
        ใช้ XGBoost จาก ProjectA เทียบกับโมเดลที่เทรนจากประวัติร้าน
        ยอดสัปดาห์ก่อน และค่าเฉลี่ยหลายวิธี เลือกวิธีรายเมนูจากการทดสอบย้อนหลัง
        28 วันสองจุดเวลาเมื่อมีข้อมูลครบ 84 วัน
        หากประวัติสั้นจะใช้ยอดสัปดาห์ก่อน ต้องมีข้อมูลอย่างน้อย 28 วันติดต่อกัน
        ผลนี้ยังไม่ผ่านการยืนยันความแม่นยำกับร้านกาแฟ และไม่มีช่วงความเชื่อมั่น
      </Notice>
      <Notice>
        ยอดสำหรับเตรียมสินค้าใช้วันส่งมอบ รวมรายการเสิร์ฟแล้วที่ยังไม่จ่าย
        ส่วนรายงานการเงินยังใช้วันรับเงิน
        ผลเก่าก่อนเปลี่ยนวิธีนับจะไม่นำมาคิดคะแนนความแม่นยำใหม่
      </Notice>
      {mode === "mixed" && (
        <Notice tone="warning">
          โหมดทดลอง: อนุญาตข้อมูลตัวอย่างร่วมด้วย
          คะแนนส่วนนี้ไม่ใช่หลักฐานความแม่นยำกับร้านจริง
        </Notice>
      )}
      {hasLegacy && (
        <Notice tone="warning">
          ช่วงวันที่นี้ยังมีผลจากโมเดลจำลองเดิม
          กดสร้างพยากรณ์ใหม่เพื่ออัปเดตวันข้างหน้า
        </Notice>
      )}
      {data?.contains_demo_history && (
        <Notice>
          ประวัติที่ใช้พยากรณ์มีข้อมูลตัวอย่าง แยกจากยอดขายจริงในหน้ารายงาน
        </Notice>
      )}
      <div className="forecast-controls">
        <Form
          noValidate
          guard={false}
          onSave={async () => {
            await mutate("/forecasts/generate", "POST", {
              date_from: addDays(today(), 1),
              date_to: addDays(today(), Number(days)),
              data_mode: mode,
              ...(product ? { product_id: product } : {}),
            });
            resource.reload();
            toast("สร้างผลพยากรณ์แล้ว");
          }}
        >
          <Select
            label="พยากรณ์ล่วงหน้า"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            <option value="7">7 วัน</option>
            <option value="28">28 วัน</option>
            <option value="30">30 วัน</option>
          </Select>
          <Submit>สร้างพยากรณ์ใหม่</Submit>
          <p className="muted forecast-scope">
            {product
              ? "สร้างเฉพาะเมนูที่กรองอยู่"
              : "สร้างทุกเมนู · เมนูใหม่ที่ประวัติไม่ครบสามารถกรองออกโดยเลือกสร้างทีละเมนู"}
          </p>
        </Form>
        <Form
          noValidate
          guard={false}
          onSave={async (fd) =>
            setParams({
              from: String(fd.get("from")),
              to: String(fd.get("to")),
              product: String(fd.get("product")),
              mode: String(fd.get("mode")),
              run: String(fd.get("run")),
              lead: String(fd.get("lead")),
            })
          }
        >
          <Input
            key={"from" + from}
            label="วันที่เริ่ม"
            name="from"
            type="date"
            defaultValue={from}
            required
          />
          <Input
            key={"to" + to}
            label="ถึงวันที่"
            name="to"
            type="date"
            defaultValue={to}
            required
          />
          <Select
            key={"product" + product}
            label="เมนู"
            name="product"
            defaultValue={product}
          >
            <option value="">ทุกเมนู</option>
            {product &&
              !catalog.data?.products.some((p) => p.id === product) && (
                <option key={product} value={product}>
                  เมนูที่เลือก · {product.slice(0, 8)}
                </option>
              )}
            {catalog.data?.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            label="ข้อมูลที่ใช้สร้าง"
            name="mode"
            key={"mode" + mode}
            defaultValue={mode}
          >
            <option value="actual">ออเดอร์ร้านเท่านั้น</option>
            <option value="mixed">ทดลอง: ใช้ข้อมูลตัวอย่างร่วมด้วย</option>
          </Select>
          <Select
            label="รอบพยากรณ์ที่แสดง"
            name="run"
            key={"run" + run}
            value={runDraft}
            onChange={(event) => setRunDraft(event.target.value)}
          >
            <option value="">ผลล่าสุดแต่ละเมนู</option>
            {runDraft && !data?.runs.some((r) => r.id === runDraft) && (
              <option key={runDraft} value={runDraft}>
                รอบที่เลือก · {runDraft.slice(0, 8)}
              </option>
            )}
            {data?.runs.map((r) => (
              <option key={r.id} value={r.id}>
                {dateText(r.generated_at, true)} · {r.id.slice(0, 8)} ·{" "}
                {r.contains_simulated_sales
                  ? "มีรายการจำลอง"
                  : r.data_mode === "actual"
                    ? "ออเดอร์ร้าน"
                    : "ทดลอง"}
              </option>
            ))}
          </Select>
          <Select
            label="ระยะล่วงหน้าที่วัดผล"
            name="lead"
            key={"lead" + lead}
            defaultValue={lead}
          >
            <option value="">ทุกระยะ (แยกในตาราง)</option>
            {[1, 7, 14, 28].map((n) => (
              <option key={n} value={n}>
                {n} วัน
              </option>
            ))}
          </Select>
          <Submit>แสดงผล</Submit>
        </Form>
      </div>
      <QueryState {...resource} retry={resource.reload} />
      {run && (
        <Form
          noValidate
          guard={false}
          onSave={async () => {
            const snapshot = await api<object>("/forecasts/runs/" + run);
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(snapshot, null, 2)], {
                type: "application/json",
              }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "forecast-" + run + ".json";
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Submit>ดาวน์โหลดรอบนี้ (JSON)</Submit>
        </Form>
      )}
      {data && (
        <>
          <details className="section-details" open>
            <summary>ความพร้อมของประวัติรายเมนู</summary>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="เลื่อนตารางความพร้อมพยากรณ์"
            >
              <table>
                <caption className="sr-only">
                  ประวัติที่ใช้ได้ในโหมดที่เลือก
                </caption>
                <thead>
                  <tr>
                    <th scope="col">เมนู</th>
                    <th scope="col">วันล่าสุด</th>
                    <th scope="col">ต่อเนื่อง</th>
                    <th scope="col">วันที่มีข้อมูลส่งมอบ</th>
                    <th scope="col">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {coverage.items.map((c) => (
                    <tr key={c.product_id}>
                      <th scope="row">{c.name}</th>
                      <td>
                        {c.latest_date
                          ? dateText(c.latest_date)
                          : "ไม่มีข้อมูล"}
                      </td>
                      <td>{c.consecutive_days} วัน</td>
                      <td>{c.actual_days} วัน</td>
                      <td>
                        {c.ready
                          ? "พร้อมรายเมนู"
                          : "ต้องมี 28 วันต่อเนื่องและข้อมูลล่าสุดไม่เก่า"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {coverage.controls}
            <p className="muted caption">
              สร้างทั้งชุดต้องมีวันสิ้นสุดประวัติร่วมกันครบด้วย
              เมนูที่ยังไม่พร้อมสามารถเลือกสร้างทีละเมนูได้
            </p>
          </details>
          <section className="chart-panel">
            <div className="section-head">
              <h2>ยอดส่งมอบและพยากรณ์</h2>
              <span className="caption muted">
                จำนวนหน่วยขาย · {dateText(from)} – {dateText(to)}
              </span>
            </div>
            {chart.length ? (
              <div className="chart forecast-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chart}>
                    <CartesianGrid
                      stroke="var(--border)"
                      strokeDasharray="3 5"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="var(--muted)"
                      tickFormatter={(v) => String(v).slice(5)}
                    />
                    <YAxis stroke="var(--muted)" width={45} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--surface)",
                        borderColor: "var(--border)",
                        color: "var(--text)",
                      }}
                      formatter={(value, name) => [
                        Array.isArray(value)
                          ? value.map((v) => number(Number(v))).join(" – ")
                          : number(Number(value)),
                        name === "actual"
                          ? "ประวัติยอดขาย"
                          : name === "forecast"
                            ? "พยากรณ์"
                            : "ช่วงค่าของผลเดิม",
                      ]}
                    />
                    <Area
                      dataKey="interval"
                      fill="var(--primary)"
                      fillOpacity={0.12}
                      stroke="none"
                      connectNulls={false}
                    />
                    <Line
                      dataKey="actual"
                      stroke="var(--text)"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                    <Line
                      dataKey="forecast"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={false}
                      connectNulls={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty">
                ยังไม่มีผลพยากรณ์ กด “สร้างพยากรณ์ใหม่” เพื่อเริ่ม
              </div>
            )}
            <div className="chart-legend">
              <span>
                ━ ประวัติยอดขาย
                {data.contains_demo_history ? " (มีข้อมูลตัวอย่าง)" : ""}
              </span>
              <span className="accent">┄ พยากรณ์</span>
              {hasLegacy && (
                <span>ช่วงแรเงาจากผลจำลองเดิม ไม่ใช่ช่วงความเชื่อมั่น</span>
              )}
            </div>
          </section>
          <div className="metrics">
            <div>
              <span>จำนวนที่พยากรณ์ในช่วงนี้</span>
              <strong>
                {number(
                  data.forecasts.reduce(
                    (s, f) => s + Number(f.predicted_qty),
                    0,
                  ),
                )}
              </strong>
              <small>สูตรพื้นฐาน ไม่รวมการเปลี่ยนตัวเลือก</small>
            </div>
            <div>
              <span>MAPE</span>
              <strong>
                {data.accuracy.mape === null
                  ? "—"
                  : number(data.accuracy.mape) + "%"}
              </strong>
              <small>ไม่นับวันที่ยอดจริงเป็นศูนย์</small>
            </div>
            <div>
              <span>RMSE</span>
              <strong>
                {data.accuracy.rmse === null ? "—" : number(data.accuracy.rmse)}
              </strong>
              <small>
                เทียบได้ {data.accuracy.samples} ตัวอย่าง · ไม่มีข้อมูลจะแสดง —
              </small>
            </div>
            <div>
              <span>MAE</span>
              <strong>
                {data.accuracy.mae === null ? "—" : number(data.accuracy.mae)}
              </strong>
              <small>จำนวนหน่วยที่คลาดเคลื่อนเฉลี่ย</small>
            </div>
            <div>
              <span>WAPE</span>
              <strong>
                {data.accuracy.wape === null
                  ? "—"
                  : number(data.accuracy.wape) + "%"}
              </strong>
              <small>ไม่กำหนดเมื่อยอดจริงรวมเป็นศูนย์</small>
            </div>
          </div>
          <p className="muted caption">
            คะแนนหลักใช้รอบข้อมูลจริงล้วนที่ออกก่อนวันเป้าหมาย
            เลือกรอบแรกของแต่ละเมนู/วัน/ระยะล่วงหน้า
            จึงไม่เพิ่มจำนวนตัวอย่างเมื่อกดสร้างซ้ำ
          </p>
          {data.contains_simulated_sales && (
            <Notice tone="warning">
              ประวัติร้านนี้มีรายการจำลองการขาย
              ผลทดสอบจากรายการจำลองแยกจากคะแนนจริงด้านบน
              {data.evaluation.by_source
                .filter((e) => e.source === "simulation")
                .map((e) => (
                  <p key={e.source}>
                    ผลทดสอบจากการจำลอง: {e.samples} ตัวอย่าง · MAE{" "}
                    {e.mae === null ? "—" : number(e.mae)} · WAPE{" "}
                    {e.wape === null ? "—" : number(e.wape) + "%"}
                  </p>
                ))}
            </Notice>
          )}
          <details className="section-details">
            <summary>ผลวัดจริงแยกเมนูและระยะล่วงหน้า</summary>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="เลื่อนตารางวัดผลพยากรณ์"
            >
              <table>
                <caption>คะแนนจากยอดส่งมอบจริง</caption>
                <thead>
                  <tr>
                    <th scope="col">เมนู</th>
                    <th scope="col">ล่วงหน้า</th>
                    <th scope="col">ตัวอย่าง</th>
                    <th scope="col">MAE</th>
                    <th scope="col">WAPE</th>
                    <th scope="col">Bias</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluationRows.items.map((e) => (
                    <tr key={e.product_id + e.lead_days}>
                      <th scope="row">
                        {catalog.data?.products.find(
                          (p) => p.id === e.product_id,
                        )?.name ?? e.product_id}
                      </th>
                      <td>{e.lead_days} วัน</td>
                      <td>{e.samples}</td>
                      <td>{e.mae === null ? "—" : number(e.mae)}</td>
                      <td>{e.wape === null ? "—" : number(e.wape) + "%"}</td>
                      <td>{e.bias === null ? "—" : number(e.bias)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!evaluationRows.items.length && (
                <p className="empty">
                  ยังไม่มีผลล่วงหน้าข้อมูลจริงล้วนที่เทียบกับยอดส่งมอบได้
                </p>
              )}
            </div>
            {evaluationRows.controls}
            <p className="muted caption">
              Bias บวก = พยากรณ์สูงไป · ลบ = ต่ำไป
              ข้อมูลตัวอย่างและผสมแสดงแยกจากคะแนนหลัก
            </p>
            <ul>
              {data.evaluation.by_source.map((e) => (
                <li key={e.source}>
                  {sourceLabel(e.source)}: {e.samples} ตัวอย่าง · MAE{" "}
                  {e.mae === null ? "—" : number(e.mae)} · WAPE{" "}
                  {e.wape === null ? "—" : number(e.wape) + "%"}
                </li>
              ))}
            </ul>
          </details>
          <h2 className="section-title">วัตถุดิบที่ควรสั่งเพิ่ม</h2>
          <p className="muted caption">
            พยากรณ์ × สูตรพื้นฐาน − สต็อกคงเหลือ ·
            ต้องตรวจสต็อกและตัวเลือกจริงก่อนสั่งซื้อ
          </p>
          <div className="table-panel">
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="เลื่อนตารางวัตถุดิบที่ควรสั่งเพิ่ม"
            >
              <table>
                <caption className="sr-only">แนะนำวัตถุดิบตามพยากรณ์</caption>
                <thead>
                  <tr>
                    <th scope="col">วัตถุดิบ</th>
                    <th scope="col">ต้องใช้</th>
                    <th scope="col">มีอยู่</th>
                    <th scope="col">แนะนำสั่งเพิ่ม</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendations.items.map((i) => (
                    <tr key={i.id}>
                      <th scope="row">{i.name}</th>
                      <td>
                        {number(i.required_qty, 3)} {i.unit}
                      </td>
                      <td>
                        {number(i.current_stock, 3)} {i.unit}
                      </td>
                      <td
                        className={
                          Number(i.order_qty) > 0 ? "warning-text" : ""
                        }
                      >
                        {number(i.order_qty, 3)} {i.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.recommendations.length && (
                <div className="empty">
                  ยังไม่มีข้อมูลสูตรและพยากรณ์สำหรับช่วงนี้
                </div>
              )}
            </div>
            {recommendations.controls}
          </div>
          <details className="section-details">
            <summary>จำนวนเตรียมรายเมนูและเวอร์ชันโมเดล</summary>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="เลื่อนตารางผลพยากรณ์รายเมนู"
            >
              <table>
                <caption>ผลพยากรณ์ที่บันทึกไว้</caption>
                <thead>
                  <tr>
                    <th scope="col">วัน</th>
                    <th scope="col">เมนู</th>
                    <th scope="col">จำนวน</th>
                    <th scope="col">ช่วงค่า</th>
                    <th scope="col">วิธีพยากรณ์</th>
                    <th scope="col">ประวัติที่ใช้</th>
                    <th scope="col">โมเดล</th>
                    <th scope="col">ข้อมูลและเหตุผล</th>
                  </tr>
                </thead>
                <tbody>
                  {forecastRows.items.map((f) => (
                    <tr key={f.date + f.product_id}>
                      <td>{dateText(f.date)}</td>
                      <th scope="row">{f.product_name}</th>
                      <td>{number(f.predicted_qty)}</td>
                      <td>
                        {f.lower_qty === null || f.upper_qty === null
                          ? "ไม่มีช่วงค่า"
                          : `${number(f.lower_qty)}–${number(f.upper_qty)}`}
                      </td>
                      <td>{methodLabel(f.model_version)}</td>
                      <td>
                        {f.history_source === "actual"
                          ? "ยอดขายจริง"
                          : f.history_source === "demo"
                            ? "ข้อมูลตัวอย่าง"
                            : f.history_source === "mixed"
                              ? "มีข้อมูลตัวอย่างร่วมด้วย"
                              : "ไม่ได้บันทึกที่มา"}
                      </td>
                      <td>{f.model_version}</td>
                      <td>
                        {f.diagnostics?.origin ? (
                          <details>
                            <summary>
                              {f.diagnostics.history_days} วัน · ถึง{" "}
                              {dateText(f.diagnostics.origin)}
                            </summary>
                            <p>
                              {f.diagnostics.reason === "short_history_weekly"
                                ? "ประวัติยังไม่ครบ 84 วัน จึงใช้ยอดสัปดาห์ก่อน"
                                : "เลือก MAE ต่ำสุดจากการทดสอบย้อนหลังสองจุดเวลา (ไม่ใช่คะแนนทดสอบอิสระ)"}
                            </p>
                            <ul>
                              {Object.entries(f.diagnostics.selection).map(
                                ([method, score]) => (
                                  <li key={method}>
                                    {methodLabel(method)}: MAE{" "}
                                    {number(score.mae)} · WAPE{" "}
                                    {score.wape === null
                                      ? "—"
                                      : number(score.wape) + "%"}{" "}
                                    · {score.samples} คู่ทดสอบ
                                  </li>
                                ),
                              )}
                            </ul>
                          </details>
                        ) : (
                          "ผลเดิมไม่มีรายละเอียด"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {forecastRows.controls}
          </details>
        </>
      )}
    </>
  );
}
