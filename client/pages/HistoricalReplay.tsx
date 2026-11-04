import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ComposedChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  Form,
  Input,
  Select,
  Submit,
  QueryState,
  Notice,
  usePagedRows,
} from "../ui";
import { mutate, useResource, number, dateText, addDays } from "../lib";
import { forecastChart } from "../forecast-view";
import type { ForecastMetrics } from "../types";

type Dataset = {
  id: string;
  data_mode: "PUBLIC_DATASET";
  metadata: {
    name: string;
    version: string;
    source_url: string;
    license: string;
    license_url: string;
    attribution: string;
    products: { id: string; name: string; external_id: string }[];
    outlets: {
      id: string;
      date_from: string;
      date_to: string;
      active_days: number;
      label?: string;
      missing_dates: string[];
    }[];
    report: {
      raw_transactions: number;
      item_occurrences: number;
      date_from: string;
      date_to: string;
      limitations: string[];
      target?: string;
      zero_policy: string;
      price_policy: string;
    };
  };
};
type Replay = {
  kind: "historical_replay";
  data_mode: "PUBLIC_DATASET";
  run: {
    id: string;
    dataset_id: string;
    created_at: string;
    cutoff: string;
    horizon: number;
    outlet_id: string;
    history_sha256: string;
    metadata: {
      pipeline: string;
      history_days: number;
      training_from: string;
      training_to: string;
      excluded_no_history: string[];
    };
  };
  dataset: Dataset["metadata"];
  date_from: string;
  date_to: string;
  score: ForecastMetrics;
  aggregate_score: ForecastMetrics;
  coverage: {
    expected: number;
    matched: number;
    missing: number;
    inferred_zero: number;
  };
  rows: {
    date: string;
    product_id: string;
    product_name: string;
    predicted_qty: number;
    lower: number | null;
    upper: number | null;
    actual_qty: number | null;
    actual_quality: string;
    error: number | null;
    model_version: string;
    diagnostics?: {
      history_days: number;
      reason: string;
      validation_origins?: number;
      selection: Record<string, ForecastMetrics>;
    };
  }[];
};

function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function HistoricalReplay() {
  const [params, setParams] = useSearchParams();
  const [generating, setGenerating] = useState(false);
  const datasets = useResource<{ datasets: Dataset[] }>("/forecasts/datasets");
  const runs = useResource<{
    runs: {
      id: string;
      created_at: string;
      dataset_id: string;
      product_id: string | null;
      metadata: { history_days: number };
      cutoff: string;
      horizon: number;
      outlet_id: string;
    }[];
  }>("/forecasts/replays");
  const selected =
    datasets.data?.datasets.find((d) => d.id === params.get("dataset")) ??
    datasets.data?.datasets[0];
  const outlet =
    selected?.metadata.outlets.find((o) => o.id === params.get("outlet")) ??
    selected?.metadata.outlets[0];
  const cutoff =
    params.get("cutoff") ?? (outlet ? addDays(outlet.date_to, -29) : "");
  const product = params.get("product") ?? "";
  const run = params.get("run");
  const result = useResource<Replay>(run ? "/forecasts/replays/" + run : null),
    data = result.data;
  const rows = usePagedRows(data?.rows ?? [], run ?? "");
  const chart = data
    ? forecastChart(
        data.date_from,
        data.date_to,
        data.rows.map((r) => ({
          ...r,
          lower_qty: r.lower,
          upper_qty: r.upper,
        })),
        data.rows
          .filter((r) => r.actual_qty !== null)
          .map((r) => ({
            date: r.date,
            product_id: r.product_id,
            qty: r.actual_qty!,
            is_closed: true,
          })),
        new Set(data.rows.map((r) => r.product_id)).size,
      )
    : [];
  const chosen =
    data?.rows.filter(
      (p, i, all) => all.findIndex((x) => x.product_id === p.product_id) === i,
    ) ?? [];
  const change = (key: string, value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(key, value);
      if (key !== "run") next.delete("run");
      if (key === "dataset") {
        next.delete("product");
        next.delete("outlet");
        next.delete("cutoff");
      }
      return next;
    });
  return (
    <>
      <div className="section-head">
        <h2>Historical Backtest (Public Dataset)</h2>
        <Link className="button" to="/forecast">
          พยากรณ์ร้าน
        </Link>
      </div>
      <p className="caption muted">
        ทดสอบข้อมูลย้อนหลังที่โมเดลยังไม่เห็น · แยกจากยอดขาย สต็อก และคะแนนร้าน
      </p>
      <QueryState {...datasets} retry={datasets.reload} />
      {datasets.data?.datasets.length === 0 && (
        <Notice>
          ยังไม่มีชุดข้อมูลสาธารณะ กรุณานำเข้าตามคู่มือ Historical Replay
          ก่อนเริ่มทดสอบ
        </Notice>
      )}
      {selected && outlet && (
        <>
          <Form
            key={
              selected.id +
              outlet.id +
              product +
              cutoff +
              (params.get("horizon") ?? "30") +
              (params.get("history") ?? "180")
            }
            noValidate
            guard={false}
            onSave={async (fd) => {
              const values = {
                dataset_id: selected.id,
                outlet_id: outlet.id,
                cutoff: String(fd.get("cutoff")),
                horizon: Number(fd.get("horizon")),
                history_days: Number(fd.get("history_days")),
                ...(product ? { product_id: product } : {}),
              };
              setGenerating(true);
              try {
                const saved = await mutate<Replay>(
                  "/forecasts/backtest",
                  "POST",
                  values,
                );
                setParams(
                  {
                    dataset: selected.id,
                    outlet: outlet.id,
                    product,
                    cutoff: values.cutoff,
                    horizon: String(values.horizon),
                    history: String(values.history_days),
                    run: saved.run.id,
                  },
                  { flushSync: true },
                );
                runs.reload();
              } finally {
                setGenerating(false);
              }
            }}
          >
            <div className="form-grid">
              <Select
                disabled={generating}
                label="Dataset / Source"
                value={selected.id}
                onChange={(e) => change("dataset", e.target.value)}
              >
                {datasets.data?.datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.metadata.name} · V{d.metadata.version}
                  </option>
                ))}
              </Select>
              <Select
                disabled={generating}
                label="สาขา / สตรีมข้อมูล"
                value={outlet.id}
                onChange={(e) => change("outlet", e.target.value)}
              >
                {selected.metadata.outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label ?? o.id}
                  </option>
                ))}
              </Select>
              <Select
                disabled={generating}
                label="สินค้าในชุดข้อมูล"
                value={product}
                onChange={(e) => change("product", e.target.value)}
              >
                <option value="">ทุกสินค้าที่มีประวัติก่อนวันตัดข้อมูล</option>
                {selected.metadata.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Input
                disabled={generating}
                label="วันเริ่มทดสอบ (as-of)"
                name="cutoff"
                type="date"
                defaultValue={cutoff}
                min={addDays(outlet.date_from, 1)}
                max={outlet.date_to}
                required
              />
              <Select
                disabled={generating}
                label="ระยะ Replay"
                name="horizon"
                defaultValue={params.get("horizon") ?? "30"}
              >
                <option value="1">1 วัน</option>
                <option value="7">7 วัน</option>
                <option value="30">30 วัน</option>
              </Select>
              <Select
                disabled={generating}
                label="ประวัติฝึกก่อนวันเริ่มทดสอบ"
                name="history_days"
                defaultValue={params.get("history") ?? "180"}
              >
                <option value="30">30 วัน</option>
                <option value="90">90 วัน</option>
                <option value="180">180 วัน</option>
              </Select>
            </div>
            <Submit>เริ่ม Historical Replay</Submit>
          </Form>
          <p className="caption muted">
            ฝึกเฉพาะข้อมูลก่อนวันเริ่มทดสอบ ·
            ใช้โมเดลและเกณฑ์เลือกวิธีเดียวกับระบบร้าน
          </p>
          <details className="section-details">
            <summary>แหล่งข้อมูล สิทธิ์ใช้งาน และข้อจำกัด</summary>
            <p>
              {selected.metadata.attribution} ·{" "}
              <a
                href={selected.metadata.source_url}
                target="_blank"
                rel="noreferrer"
              >
                แหล่งข้อมูลต้นฉบับ
              </a>{" "}
              ·{" "}
              <a
                href={selected.metadata.license_url}
                target="_blank"
                rel="noreferrer"
              >
                {selected.metadata.license}
              </a>
            </p>
            <p>
              {dateText(selected.metadata.report.date_from)}–
              {dateText(selected.metadata.report.date_to)} ·{" "}
              {number(selected.metadata.report.raw_transactions, 0)} แถวข้อมูล ·{" "}
              {number(selected.metadata.report.item_occurrences, 0)}{" "}
              รายการที่นับได้
            </p>
            <p>{selected.metadata.report.target}</p>
            <p>{selected.metadata.report.zero_policy}</p>
            <p>{selected.metadata.report.price_policy}</p>
            <p>
              ข้อมูลชุดนี้ใช้พยากรณ์และวัดผล
              ไม่มีการเชื่อมสูตรหรือสต็อกของร้านต้นทาง
            </p>
            <ul>
              {selected.metadata.report.limitations.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </details>
        </>
      )}
      <QueryState {...runs} retry={runs.reload} />
      {!!runs.data?.runs.length && (
        <Select
          disabled={generating}
          label="รอบ Replay ที่บันทึก"
          value={run ?? ""}
          onChange={(e) => {
            const r = runs.data?.runs.find((r) => r.id === e.target.value);
            if (r)
              setParams(
                {
                  dataset: r.dataset_id,
                  outlet: r.outlet_id,
                  product: r.product_id ?? "",
                  cutoff: r.cutoff,
                  horizon: String(r.horizon),
                  history: String(r.metadata.history_days),
                  run: r.id,
                },
                { flushSync: true },
              );
            else change("run", "");
          }}
        >
          <option value="">เลือกรอบที่บันทึกไว้</option>
          {runs.data.runs.map((r) => (
            <option key={r.id} value={r.id}>
              {dateText(r.created_at, true)} · {r.outlet_id} · {r.cutoff} ·{" "}
              {r.horizon} วัน · {r.id.slice(0, 8)}
            </option>
          ))}
        </Select>
      )}
      {run && <QueryState {...result} retry={result.reload} />}
      {data && (
        <>
          <p>
            ผลย้อนหลัง · {data.dataset.name} · {data.run.outlet_id} ·{" "}
            {dateText(data.date_from)}–{dateText(data.date_to)}
          </p>
          <p className="caption muted">
            ฝึก {dateText(data.run.metadata.training_from)}–
            {dateText(data.run.metadata.training_to)} · บันทึกเมื่อ{" "}
            {dateText(data.run.created_at, true)} ·
            ไม่ใช่ผลวัดล่วงหน้าของร้านที่ใช้งานจริง
          </p>
          <p className="caption muted">คะแนนรายสินค้า / วัน</p>
          <div className="metrics">
            {(["mae", "rmse", "wape", "bias"] as const).map((key) => (
              <div key={key}>
                <span>{key.toUpperCase()}</span>
                <strong>
                  {data.score[key] === null
                    ? "—"
                    : number(data.score[key]) + (key === "wape" ? "%" : "")}
                </strong>
                <small>
                  {key === "bias"
                    ? "บวก = สูงไป · ลบ = ต่ำไป"
                    : data.score.samples + " คู่ทดสอบ"}
                </small>
              </div>
            ))}
          </div>
          <details className="section-details">
            <summary>คะแนนยอดรวมรายวัน</summary>
            <p className="caption muted">
              วัดยอดรวมของสินค้าที่เลือกในแต่ละวันตามกราฟ ใช้เฉพาะวันที่มี
              Actual ครบ ไม่ใช่ความแม่นยำรายสินค้า
            </p>
            <p>
              MAE{" "}
              {data.aggregate_score.mae === null
                ? "—"
                : number(data.aggregate_score.mae)}{" "}
              · RMSE{" "}
              {data.aggregate_score.rmse === null
                ? "—"
                : number(data.aggregate_score.rmse)}{" "}
              · WAPE{" "}
              {data.aggregate_score.wape === null
                ? "—"
                : number(data.aggregate_score.wape) + "%"}{" "}
              · Bias{" "}
              {data.aggregate_score.bias === null
                ? "—"
                : number(data.aggregate_score.bias)}{" "}
              · {data.aggregate_score.samples} วัน
            </p>
          </details>
          <section className="chart-panel">
            <h2>Actual vs Forecast</h2>
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
                    tickFormatter={(v) => String(v).slice(5)}
                    stroke="var(--muted)"
                  />
                  <YAxis stroke="var(--muted)" width={45} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      borderColor: "var(--border)",
                    }}
                  />
                  <Line
                    name="Actual"
                    dataKey="actual"
                    stroke="var(--text)"
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Line
                    name="Forecast"
                    dataKey="forecast"
                    stroke="var(--primary)"
                    strokeDasharray="5 4"
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="caption muted">
              เส้นทึบ = Actual · เส้นประ = Forecast · หน่วยรายการสินค้า ·
              ช่องว่างคงเป็นไม่ทราบยอด
            </p>
          </section>
          <p className="caption muted">
            จับคู่ {data.coverage.matched}/{data.coverage.expected} · ไม่ทราบยอด{" "}
            {data.coverage.missing} · ศูนย์แบบอนุมาน{" "}
            {data.coverage.inferred_zero} · สินค้าไม่มีประวัติที่กันออก{" "}
            {data.run.metadata.excluded_no_history.length}
          </p>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="เลื่อนผลรายวัน Historical Replay"
          >
            <table>
              <caption>ผลรายสินค้าและวัน</caption>
              <thead>
                <tr>
                  {[
                    "วัน",
                    "สินค้า",
                    "Actual",
                    "Forecast",
                    "ช่วงค่า",
                    "Bias รายจุด",
                    "คุณภาพยอดจริง",
                    "โมเดล",
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.items.map((r) => (
                  <tr key={r.date + r.product_id}>
                    <td>{dateText(r.date)}</td>
                    <th scope="row">{r.product_name}</th>
                    <td>
                      {r.actual_qty === null ? "—" : number(r.actual_qty)}
                    </td>
                    <td>{number(r.predicted_qty)}</td>
                    <td>
                      {r.lower === null || r.upper === null
                        ? "—"
                        : number(r.lower) + "–" + number(r.upper)}
                    </td>
                    <td>{r.error === null ? "—" : number(r.error)}</td>
                    <td>
                      {r.actual_quality === "inferred_zero"
                        ? "ศูนย์แบบอนุมาน"
                        : r.actual_quality === "unknown"
                          ? "ไม่ทราบยอด"
                          : "พบรายการขาย"}
                    </td>
                    <td>{r.model_version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.controls}
          <details className="section-details">
            <summary>Model selected และคะแนนเลือกวิธีภายในช่วงฝึก</summary>
            <p className="caption muted">
              คะแนนเหล่านี้ใช้เลือกวิธีก่อนช่วงทดสอบ ไม่ใช่คะแนน held-out ด้านบน
            </p>
            {chosen.map((p) => (
              <div key={p.product_id}>
                <p>
                  {p.product_name} · {p.model_version} ·{" "}
                  {p.diagnostics?.history_days ?? 0} วัน ·{" "}
                  {p.diagnostics?.validation_origins ?? 0} จุดทดสอบ
                </p>
                {p.diagnostics?.reason === "limited_history_mean" && (
                  <p>ข้อมูลยังไม่พอเลือกโมเดล จึงใช้วิธีพื้นฐาน</p>
                )}
                <ul>
                  {Object.entries(p.diagnostics?.selection ?? {}).map(
                    ([model, score]) => (
                      <li key={model}>
                        {model} · MAE{" "}
                        {score.mae === null ? "—" : number(score.mae)} ·{" "}
                        {score.samples} คู่
                      </li>
                    ),
                  )}
                </ul>
              </div>
            ))}
          </details>
          <button
            type="button"
            onClick={() =>
              download(data, "historical-replay-" + data.run.id + ".json")
            }
          >
            ดาวน์โหลดผล Replay (JSON)
          </button>
          <p className="caption muted">
            Run {data.run.id} · ชุดข้อมูล {data.run.dataset_id} ·{" "}
            {data.run.metadata.pipeline}
          </p>
        </>
      )}
    </>
  );
}
