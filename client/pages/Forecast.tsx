import { useState } from "react";
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
import { addDays, dateText, mutate, number, today, useResource } from "../lib";
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
  return version.startsWith("mock-") ? "โมเดลจำลองเดิม" : "ไม่ทราบวิธี";
}
export default function Forecast() {
  const [params, setParams] = useSearchParams();
  const from = params.get("from") ?? addDays(today(), -7);
  const to = params.get("to") ?? addDays(today(), 7);
  const product = params.get("product") ?? "";
  const [days, setDays] = useState("7");
  const catalog = useResource<Catalog>("/catalog");
  const resource = useResource<Forecasts>(
    `/forecasts?date_from=${from}&date_to=${to}${product ? "&product_id=" + product : ""}`,
  );
  const toast = useToast();
  const data = resource.data;
  const hasLegacy = data?.model_mode === "mock" || data?.model_mode === "mixed";
  const recommendations = usePagedRows(
    data?.recommendations ?? [],
    from + to + product,
  );
  const forecastRows = usePagedRows(data?.forecasts ?? [], from + to + product);
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
        ใช้ XGBoost จาก ProjectA
        เทียบกับโมเดลที่เทรนจากประวัติร้านและวิธียอดสัปดาห์ก่อน
        เลือกวิธีรายเมนูจากผลย้อนหลัง 28 วันเมื่อมีข้อมูลครบ 84 วัน
        หากประวัติสั้นจะใช้ยอดสัปดาห์ก่อน ต้องมีข้อมูลอย่างน้อย 28 วันติดต่อกัน
        ผลนี้ยังไม่ผ่านการยืนยันความแม่นยำกับร้านกาแฟ และไม่มีช่วงความเชื่อมั่น
      </Notice>
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
        </Form>
        <Form
          noValidate
          guard={false}
          onSave={async (fd) =>
            setParams({
              from: String(fd.get("from")),
              to: String(fd.get("to")),
              product: String(fd.get("product")),
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
            {catalog.data?.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Submit>แสดงผล</Submit>
        </Form>
      </div>
      <QueryState {...resource} retry={resource.reload} />
      {data && (
        <>
          <section className="chart-panel">
            <div className="section-head">
              <h2>ยอดขายจริงและพยากรณ์</h2>
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
          </div>
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
