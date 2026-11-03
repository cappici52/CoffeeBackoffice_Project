import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
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
import ForecastData, { cohortLabel } from "../components/ForecastData";
import ForecastMonitor from "../components/ForecastMonitor";
import ForecastBacktest from "../components/ForecastBacktest";
import {
  forecastChart,
  forecastCsv,
  forecastScore,
  monthRange,
} from "../forecast-view";
function stockAmount(value: number | string, unit: string) {
  const n = Number(value);
  return unit === "ml" && n >= 1000
    ? number(n / 1000, 2) + " ลิตร"
    : unit === "g" && n >= 1000
      ? number(n / 1000, 2) + " กก."
      : number(n, 3) + " " + unit;
}
function methodLabel(version: string) {
  if (/^coffee-direct-v[45]-/.test(version)) return "XGBoost รายระยะจากยอดร้าน";
  if (version === "scheduled-closure-v1") return "วันหยุดขายที่บันทึกไว้";
  if (version.startsWith("coffee-xgb-")) return "XGBoost ประวัติร้าน";
  if (version.startsWith("projecta-xgb-")) return "XGBoost ProjectA";
  if (version === "last-value-v1") return "ยอดวันล่าสุด";
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
  const cohort =
    ["auto", "genuine", "simulation", "demo"].includes(
      params.get("cohort") ?? "",
    ) &&
    (mode === "mixed" || params.get("cohort") !== "demo")
      ? params.get("cohort")!
      : "auto";
  const run = params.get("run") ?? "";
  const safety = params.get("safety") ?? "";
  const [runDraft, setRunDraft] = useState(run);
  useEffect(() => setRunDraft(run), [run]);
  const lead = params.get("lead") ?? "";
  const requestedScore = params.get("score") ?? "auto";
  const scoreScope = [
    "auto",
    "actual",
    "simulation",
    "demo",
    "mixed",
    "unknown",
  ].includes(requestedScore)
    ? requestedScore
    : "auto";
  const [days, setDays] = useState("7");
  const [methodPolicy, setMethodPolicy] = useState("auto");
  const catalog = useResource<Catalog>("/catalog");
  const resource = useResource<Forecasts>(
    `/forecasts?date_from=${from}&date_to=${to}&data_mode=${mode}${product ? "&product_id=" + product : ""}${run ? "&run_id=" + run : ""}${lead ? "&lead_days=" + lead : ""}${safety ? "&safety_factor=" + safety : ""}`,
  );
  const toast = useToast();
  const data = resource.data;
  const chartMenuCount =
    new Set(data?.forecasts.map((f) => f.product_id) ?? []).size ||
    data?.coverage.length ||
    0;
  const hasLegacy = data?.model_mode === "mock" || data?.model_mode === "mixed";
  const recommendations = usePagedRows(
    data?.recommendations ?? [],
    from + to + product,
  );
  const forecastRows = usePagedRows(data?.forecasts ?? [], from + to + product);
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
  const chart = forecastChart(
    from,
    to,
    data?.forecasts ?? [],
    data?.actual ?? [],
    chartMenuCount,
  );
  const known = chart.filter(
    (r) =>
      r.actual !== undefined ||
      r.partialActual !== undefined ||
      r.forecast !== undefined,
  );
  const gapDates = chart.filter(
    (r) =>
      known.length > 1 &&
      r.date > known[0]!.date &&
      r.date < known.at(-1)!.date &&
      r.actual === undefined &&
      r.partialActual === undefined &&
      r.forecast === undefined,
  );
  const gapStarts = gapDates.filter(
    (r, i) =>
      i === 0 ||
      Date.parse(r.date) - Date.parse(gapDates[i - 1]!.date) > 86400000,
  );
  const partialDate = chart.find((r) => r.partialActual !== undefined);
  const selectedScore = data ? forecastScore(data, scoreScope) : null;
  const displayedMetrics = selectedScore?.metrics;
  return (
    <>
      <details className="section-details">
        <summary>เกี่ยวกับการพยากรณ์</summary>
        <p className="caption muted">
          ใช้จำนวนส่งมอบรายเมนู เลือกวิธีจากการทดสอบตามเวลา ไม่บังคับให้ XGBoost
          ชนะ ช่วงค่ามาจากความคลาดเคลื่อนย้อนหลัง ส่วนรายงานการเงินนับวันรับเงิน
        </p>
      </details>
      {mode === "mixed" && (
        <Notice tone="warning">
          โหมดทดลอง: อนุญาตข้อมูลตัวอย่างร่วมด้วย
          คะแนนส่วนนี้ไม่ใช่หลักฐานความแม่นยำกับร้านจริง
        </Notice>
      )}
      <ForecastData
        cohort={cohort}
        mode={mode}
        product={product}
        onCohort={(value) =>
          setParams((previous) => {
            const next = new URLSearchParams(previous);
            next.set("cohort", value);
            return next;
          })
        }
        onSaved={resource.reload}
      />
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
      <h2 className="section-title">สร้างพยากรณ์</h2>
      <div className="forecast-controls">
        <Form
          noValidate
          guard={false}
          onSave={async () => {
            await mutate("/forecasts/generate", "POST", {
              date_from: addDays(today(), 1),
              date_to: addDays(today(), Number(days)),
              data_mode: mode,
              cohort,
              method_policy: methodPolicy,
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
            <option value="1">1 วัน</option>
            <option value="7">7 วัน</option>
            <option value="30">30 วัน</option>
          </Select>
          <Select
            label="วิธีสำหรับรอบใหม่"
            value={methodPolicy}
            onChange={(e) => setMethodPolicy(e.target.value)}
          >
            <option value="mean28">ค่าเฉลี่ย 28 วัน (เลือกเอง)</option>
            <option value="auto">เลือกโมเดลอัตโนมัติ</option>
            <option value="weekly">ยอดวันเดียวกันสัปดาห์ก่อน</option>
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
              score: scoreScope,
              cohort,
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
            <option value="">รอบล่าสุดอัตโนมัติ</option>
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
      <Form
        noValidate
        guard={false}
        onSave={async (fd) => {
          const range = monthRange(String(fd.get("month")));
          setParams((previous) => {
            const next = new URLSearchParams(previous);
            next.set("from", range.from);
            next.set("to", range.to);
            next.delete("run");
            return next;
          });
        }}
      >
        <Input
          key={from.slice(0, 7)}
          label="ดูรายเดือน"
          name="month"
          type="month"
          defaultValue={from.slice(0, 7)}
          required
        />
        <Submit>แสดงเดือนนี้</Submit>
        {[-1, 1].map((offset) => (
          <button
            key={offset}
            type="button"
            onClick={() => {
              const range = monthRange(from.slice(0, 7), offset);
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set("from", range.from);
                next.set("to", range.to);
                next.delete("run");
                return next;
              });
            }}
          >
            {offset < 0 ? "เดือนก่อนหน้า" : "เดือนถัดไป"}
          </button>
        ))}
      </Form>
      <ForecastBacktest
        product={product}
        cohort={cohort}
        mode={mode}
        catalog={catalog.data}
      />
      <QueryState {...resource} retry={resource.reload} />
      {data && (
        <Form
          noValidate
          guard={false}
          onSave={async () => {
            const url = URL.createObjectURL(
              new Blob([forecastCsv(from, to, data)], {
                type: "text/csv;charset=utf-8",
              }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = `sales-forecast-${from}-${to}.csv`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Submit>ส่งออก CSV ตามช่วงที่เลือก</Submit>
          <p className="caption muted">
            ประวัติดูและส่งออกตามช่วงวันที่ได้สูงสุด 367 วัน ·
            ระบบใหม่ใช้ประวัติล่าสุดสูงสุด 180 วัน · ช่องว่างหมายถึงไม่ทราบยอด
            ไม่ใช่ศูนย์
          </p>
        </Form>
      )}
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
          <section className="chart-panel">
            <div className="section-head">
              <h2>ยอดส่งมอบและพยากรณ์</h2>
              <span className="caption muted">
                จำนวนหน่วยขาย · {dateText(from)} – {dateText(to)}
              </span>
            </div>
            {data.displayed_run && (
              <p className="caption muted">
                แสดงรอบเดียว: {dateText(data.displayed_run.generated_at, true)}{" "}
                · {data.displayed_run.id.slice(0, 8)}
                {" · "}
                {data.displayed_run.input_quality?.pipeline ?? "ระบบเดิม"}
                {" · "}
                {cohortLabel(data.displayed_run.training_cohort ?? "legacy")}
              </p>
            )}
            {known.length ? (
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
                    {gapStarts.slice(0, 3).map((r) => (
                      <ReferenceLine
                        key={r.date}
                        x={r.date}
                        stroke="var(--warning)"
                        strokeDasharray="2 4"
                        label={{
                          value: "ไม่มีข้อมูล",
                          fill: "var(--warning)",
                          position: "insideTop",
                          fontSize: 12,
                        }}
                      />
                    ))}
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
                      isAnimationActive={false}
                      dataKey="interval"
                      fill="var(--primary)"
                      fillOpacity={0.12}
                      stroke="none"
                      connectNulls={false}
                    />
                    <Line
                      isAnimationActive={false}
                      dataKey="actual"
                      stroke="var(--text)"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls={false}
                    />
                    <Line
                      isAnimationActive={false}
                      dataKey="partialActual"
                      name="ยอดบางส่วน / ยังไม่ปิดวัน"
                      stroke="var(--warning)"
                      strokeWidth={0}
                      dot={{ r: 4 }}
                      activeDot={{ r: 5 }}
                      connectNulls={false}
                    />
                    <Line
                      isAnimationActive={false}
                      dataKey="forecast"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={
                        chart.filter((r) => r.forecast !== undefined).length ===
                        1
                          ? { r: 3 }
                          : false
                      }
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
              <span className="warning-text">
                ● ยอดบางส่วน / ยังไม่ปิดวัน (ไม่ใช้ฝึกหรือวัดผล)
              </span>
              {hasLegacy && (
                <span>ช่วงแรเงาจากผลจำลองเดิม ไม่ใช่ช่วงความเชื่อมั่น</span>
              )}
            </div>
            {gapDates.length > 0 && (
              <p className="caption warning-text">
                ไม่มีข้อมูล {gapDates.length} วัน เช่น{" "}
                {dateText(gapDates[0]!.date)} จึงเว้นเส้นไว้
                ไม่เติมยอดเป็นศูนย์หรือเชื่อมข้ามวันที่ไม่ทราบยอด
              </p>
            )}
            {partialDate && (
              <p className="caption muted">
                {dateText(partialDate.date)} มีข้อมูลส่งมอบ{" "}
                {partialDate.actual_menus}/{chartMenuCount} เมนู
                เมนูที่ไม่มีข้อมูลยังไม่ถูกนับเป็นศูนย์
                และยอดที่ยังไม่ปิดวันแสดงเป็นจุดแยกจากเส้นยอดเต็มวัน
              </p>
            )}
            <p className="caption muted">
              เส้นยอดส่งมอบจบเมื่อสิ้นสุดประวัติที่บันทึก
              ส่วนเส้นพยากรณ์แสดงเฉพาะวันเป้าหมายของรอบที่เลือก
            </p>
            <p className="caption muted">
              แถบช่วงค่ามาจากความคลาดเคลื่อนย้อนหลังที่กันไว้ ตั้งเป้าครอบคลุม
              80% รายเมนู ต้องตรวจผลที่เกิดขึ้นจริงเพิ่มเติม
              การรวมขอบหลายเมนูในกราฟไม่ใช่ช่วง 80% ของยอดรวมร้าน
            </p>
          </section>
          <Select
            label="คะแนนที่แสดง"
            value={scoreScope}
            onChange={(e) =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set("score", e.target.value);
                return next;
              })
            }
          >
            <option value="auto">อัตโนมัติตามข้อมูล</option>
            {data.evaluation.by_source
              .filter(
                (e) =>
                  e.source === "actual" ||
                  e.samples > 0 ||
                  e.source === selectedScore?.source,
              )
              .map((e) => (
                <option key={e.source} value={e.source}>
                  {sourceLabel(e.source)} · {e.samples} คู่ทดสอบ
                </option>
              ))}
          </Select>
          <ForecastMonitor
            data={data}
            source={selectedScore?.source ?? "actual"}
          />
          <p className="caption muted">
            กำลังแสดงคะแนน: {sourceLabel(selectedScore?.source ?? "actual")} ·
            ช่วงวันที่ เมนู และระยะล่วงหน้าที่เลือก
            {" · รุ่น "}
            {data.evaluation.pipeline ?? "legacy"}
          </p>
          <div className="metrics">
            <div>
              <span>พยากรณ์พรุ่งนี้</span>
              <strong>
                {data.summary?.tomorrow == null
                  ? "—"
                  : number(data.summary.tomorrow)}
              </strong>
              <small>หน่วยขาย</small>
            </div>
            <div>
              <span>เฉลี่ย 7 วันล่าสุดที่ปิดยอด</span>
              <strong>
                {data.summary?.seven_day_average == null
                  ? "—"
                  : number(data.summary.seven_day_average)}
              </strong>
              <small>
                {data.summary?.change_percent == null
                  ? "ยังไม่มีประวัติครบ 7 วัน"
                  : (data.summary.change_percent >= 0 ? "+" : "") +
                    number(data.summary.change_percent) +
                    "% สำหรับพรุ่งนี้"}
              </small>
            </div>
          </div>
          <div className="table-panel">
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="เลื่อนแผนเตรียมรายเมนู"
            >
              <table>
                <caption>เมนูที่คาดว่าจะขาย · รวมวันอนาคตที่แสดง</caption>
                <thead>
                  <tr>
                    <th scope="col">เมนู</th>
                    <th scope="col">จำนวนเตรียม</th>
                    <th scope="col">MAE ที่วัดได้</th>
                    <th scope="col">สต็อกตามแผนรวม</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(data.planning?.products ?? [])]
                    .sort((a, b) => b.predicted_qty - a.predicted_qty)
                    .map((p) => {
                      const score = data.evaluation.by_product?.find(
                        (e) =>
                          e.product_id === p.product_id &&
                          e.source === selectedScore?.source,
                      );
                      return (
                        <tr key={p.product_id}>
                          <th scope="row">
                            {catalog.data?.products.find(
                              (c) => c.id === p.product_id,
                            )?.name ?? p.product_id}
                          </th>
                          <td>{number(p.predicted_qty)}</td>
                          <td>
                            {score?.mae == null ? "—" : number(score.mae)}
                          </td>
                          <td
                            className={
                              p.status === "sufficient" ? "" : "warning-text"
                            }
                          >
                            {p.status === "sufficient"
                              ? "เพียงพอ"
                              : p.status === "missing_recipe"
                                ? "ยังไม่มีสูตร"
                                : "ต้องเติมวัตถุดิบ"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
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
              <span>MAE</span>
              <strong>
                {displayedMetrics?.mae == null
                  ? "—"
                  : number(displayedMetrics.mae)}
              </strong>
              <small>คลาดเคลื่อนเฉลี่ยต่อเมนู/วัน</small>
            </div>
            <div>
              <span>RMSE</span>
              <strong>
                {displayedMetrics?.rmse == null
                  ? "—"
                  : number(displayedMetrics.rmse)}
              </strong>
              <small>
                เทียบได้ {displayedMetrics?.samples ?? 0} ตัวอย่าง ·
                ไม่มีข้อมูลจะแสดง —
              </small>
            </div>
            <div>
              <span>Bias</span>
              <strong>
                {displayedMetrics?.bias == null
                  ? "—"
                  : number(displayedMetrics.bias)}
              </strong>
              <small>บวก = สูงไป · ลบ = ต่ำไป</small>
            </div>
            <div>
              <span>WAPE</span>
              <strong>
                {displayedMetrics?.wape == null
                  ? "—"
                  : number(displayedMetrics.wape) + "%"}
              </strong>
              <small>ไม่กำหนดเมื่อยอดจริงรวมเป็นศูนย์</small>
            </div>
          </div>
          <p className="muted caption">
            คะแนนใช้ผลที่ออกก่อนวันเป้าหมายและมียอดส่งมอบจับคู่ได้
            แยกตามที่มาของข้อมูล เลือกรอบแรกของแต่ละเมนู/วัน/ระยะล่วงหน้า
            จึงไม่เพิ่มจำนวนตัวอย่างเมื่อกดสร้างซ้ำ
          </p>
          {displayedMetrics?.samples === 0 && (
            <Notice>
              ยังไม่มีคู่ข้อมูลสำหรับคะแนนที่เลือก
              ต้องมีรอบพยากรณ์ที่ออกก่อนวันเป้าหมายและยอดปิดวันที่ตรงกัน
              วันอนาคตหรือวันที่ไม่มีผลล่วงหน้าเก็บไว้ จึงยังคำนวณ
              MAE/RMSE/WAPE/Bias ไม่ได้
            </Notice>
          )}
          {data.evaluation.latest_test && (
            <Link
              className="button"
              to={
                "?" +
                new URLSearchParams({
                  from: data.evaluation.latest_test.date_from,
                  to: data.evaluation.latest_test.date_to,
                  run: data.evaluation.latest_test.id,
                  mode: "actual",
                  product,
                  score: "simulation",
                  lead: "",
                })
              }
            >
              ดูผลทดสอบย้อนหลัง 30 วัน
            </Link>
          )}
          {data.contains_simulated_sales && (
            <p className="caption muted">คะแนนชุดจำลอง · แยกจากยอดปกติ</p>
          )}
          <details className="section-details">
            <summary>เปรียบเทียบระยะ 1, 7 และ 30 วันกับยอดสัปดาห์ก่อน</summary>
            <p className="caption muted">
              คะแนนจากรอบที่บันทึกไว้และวันที่ปิดยอดแล้ว
              ตามแหล่งข้อมูลที่เลือกด้านบน ระยะ 7 และ 30
              วันรวมทุกวันตั้งแต่วันแรกถึงระยะนั้น
              วิธีพื้นฐานใช้ประวัติที่มีตอนออกพยากรณ์ ไม่เห็นคำตอบล่วงหน้า
            </p>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="เลื่อนตารางเปรียบเทียบระยะพยากรณ์"
            >
              <table>
                <caption>
                  ผลทดสอบตามระยะ ·{" "}
                  {sourceLabel(selectedScore?.source ?? "actual")}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">ระยะ</th>
                    <th scope="col">คู่ทดสอบ</th>
                    <th scope="col">MAE</th>
                    <th scope="col">RMSE</th>
                    <th scope="col">MAPE</th>
                    <th scope="col">WAPE</th>
                    <th scope="col">MAE เทียบวิธีพื้นฐาน (คู่เดียวกัน)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.evaluation.by_horizon
                    ?.filter((e) => e.source === selectedScore?.source)
                    .map((e) => (
                      <tr key={e.horizon}>
                        <th scope="row">1–{e.horizon} วัน</th>
                        <td>{e.samples}</td>
                        {[e.mae, e.rmse, e.mape, e.wape].map((v, i) => (
                          <td key={i}>
                            {v == null ? "—" : number(v) + (i > 1 ? "%" : "")}
                          </td>
                        ))}
                        <td>
                          {e.baseline.samples
                            ? `${number(e.paired_model.mae!)} / ${number(e.baseline.mae!)} · ${e.baseline.samples} คู่`
                            : "ไม่มี snapshot ที่เทียบได้"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="caption muted">
              ใช้ช่วยเตรียมของช่วง 1–7 วันก่อน ส่วน 30 วันใช้วางแผนแนวโน้ม
              ตรวจยอดจริงและสต็อกก่อนตัดสินใจซื้อ
              ผลจากข้อมูลจำลองยังไม่ยืนยันความแม่นยำกับลูกค้าจริง
            </p>
          </details>
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
          <h2 className="section-title">แผนเตรียมวัตถุดิบ</h2>
          <Form
            noValidate
            guard={false}
            onSave={async (fd) =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                next.set("safety", String(1 + Number(fd.get("buffer")) / 100));
                return next;
              })
            }
          >
            <Input
              key={String(data.planning?.safety_factor)}
              label="เผื่อวัตถุดิบ (%)"
              name="buffer"
              type="number"
              min={0}
              max={100}
              step={1}
              defaultValue={Math.round(
                ((data.planning?.safety_factor ?? 1) - 1) * 100,
              )}
            />
            <Submit>คำนวณแผน</Submit>
          </Form>
          <p className="muted caption">
            เฉพาะวันอนาคต: พยากรณ์ × สูตรพื้นฐาน − สต็อกคงเหลือ ·
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
                    <th scope="col">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {recommendations.items.map((i) => (
                    <tr key={i.id}>
                      <th scope="row">{i.name}</th>
                      <td>{stockAmount(i.required_qty, i.unit)}</td>
                      <td>{stockAmount(i.current_stock, i.unit)}</td>
                      <td
                        className={
                          Number(i.order_qty) > 0 ? "warning-text" : ""
                        }
                      >
                        {stockAmount(i.order_qty, i.unit)}
                      </td>
                      <td>{Number(i.order_qty) > 0 ? "ขาด" : "เพียงพอ"}</td>
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
                          ? "ข้อมูลออเดอร์ร้าน"
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
                              {f.diagnostics.reason === "limited_history_mean"
                                ? "ประวัติยังไม่พอเลือกโมเดล จึงใช้ค่าเฉลี่ยช่วงล่าสุด"
                                : "เลือกตามผลทดสอบก่อนช่วงเป้าหมายและเกณฑ์ความสม่ำเสมอ"}
                            </p>
                            {f.diagnostics.horizon && (
                              <p className="caption muted">
                                ทดสอบระยะ {f.diagnostics.horizon} วัน ·{" "}
                                {f.diagnostics.validation_origins ?? 0} จุดเวลา
                                · ข้ามวันที่ยังไม่ทราบยอด{" "}
                                {f.diagnostics.gap_days ?? 0}{" "}
                                วันก่อนเริ่มช่วงเป้าหมาย
                              </p>
                            )}
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
