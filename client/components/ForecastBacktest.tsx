import { useState } from "react";
import {
  ComposedChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Catalog, Forecasts, ForecastMetrics } from "../types";
import { Form, Input, Select, Submit } from "../ui";
import { mutate, number, dateText, today, addDays } from "../lib";
import { forecastChart } from "../forecast-view";
import { cohortLabel } from "./ForecastData";
type Analysis = {
  analysis_id: string;
  kind: "backtest";
  cutoff: string;
  date_from: string;
  date_to: string;
  cohort: string;
  history_days: number;
  history_observations: number;
  forecasts: Forecasts["forecasts"];
  actual: Forecasts["actual"];
  score: ForecastMetrics;
};
export default function ForecastBacktest({
  product,
  cohort,
  mode,
  catalog,
}: {
  product: string;
  cohort: string;
  mode: string;
  catalog: Catalog | null;
}) {
  const [result, setResult] = useState<Analysis | null>(null);
  const chart = result
    ? forecastChart(
        result.date_from,
        result.date_to,
        result.forecasts,
        result.actual,
        new Set(result.forecasts.map((p) => p.product_id)).size,
      )
    : [];
  return (
    <details className="section-details">
      <summary>ทดสอบย้อนหลังโดยกำหนดวันตัดข้อมูล</summary>
      <Form
        noValidate
        guard={false}
        onSave={async (fd) => {
          const data = await mutate<Analysis>("/forecasts/backtest", "POST", {
            cutoff: String(fd.get("cutoff")),
            horizon: Number(fd.get("horizon")),
            history_days: Number(fd.get("history_days")),
            cohort,
            data_mode: mode,
            ...(product ? { product_id: product } : {}),
          });
          setResult(data);
        }}
      >
        <Input
          label="ใช้ข้อมูลถึงวันที่"
          name="cutoff"
          type="date"
          defaultValue={addDays(today().slice(0, 7) + "-01", -1)}
          max={addDays(today(), -1)}
          required
        />
        <Select label="ระยะทดสอบ" name="horizon" defaultValue="30">
          <option value="1">1 วัน</option>
          <option value="7">7 วัน</option>
          <option value="30">30 วัน</option>
        </Select>
        <Select label="ประวัติย้อนหลัง" name="history_days" defaultValue="180">
          <option value="30">ประมาณ 1 เดือน (30 วัน)</option>
          <option value="90">ประมาณ 3 เดือน (90 วัน)</option>
          <option value="180">ประมาณ 6 เดือน (180 วัน)</option>
        </Select>
        <Submit>วิเคราะห์ย้อนหลัง</Submit>
      </Form>
      {result && (
        <>
          <p className="caption muted">
            ผลวิเคราะห์ย้อนหลัง · {cohortLabel(result.cohort)} ·
            ไม่บันทึกเป็นรอบที่เคยออกในอดีต
          </p>
          <p>
            ใช้ประวัติถึง {dateText(result.cutoff)} → ทดสอบ{" "}
            {dateText(result.date_from)}–{dateText(result.date_to)}
          </p>
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
                  name="ยอดส่งมอบ"
                  dataKey="actual"
                  stroke="var(--text)"
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                <Line
                  name="ผลวิเคราะห์"
                  dataKey="forecast"
                  stroke="var(--primary)"
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="caption muted">
            จับคู่ยอดปิดวันได้ {result.score.samples} คู่ · MAE{" "}
            {result.score.mae == null ? "—" : number(result.score.mae)} · RMSE{" "}
            {result.score.rmse == null ? "—" : number(result.score.rmse)} · WAPE{" "}
            {result.score.wape == null ? "—" : number(result.score.wape) + "%"}{" "}
            · Bias {result.score.bias == null ? "—" : number(result.score.bias)}
          </p>
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="เลื่อนวิธีที่ใช้วิเคราะห์ย้อนหลัง"
          >
            <table>
              <caption>วิธีที่เลือกจากข้อมูลก่อนช่วงเป้าหมาย</caption>
              <thead>
                <tr>
                  <th scope="col">เมนู</th>
                  <th scope="col">ประวัติ</th>
                  <th scope="col">วิธี</th>
                  <th scope="col">จุดทดสอบ</th>
                </tr>
              </thead>
              <tbody>
                {result.forecasts
                  .filter(
                    (p, i, all) =>
                      all.findIndex((x) => x.product_id === p.product_id) === i,
                  )
                  .map((p) => (
                    <tr key={p.product_id}>
                      <th scope="row">
                        {catalog?.products.find((c) => c.id === p.product_id)
                          ?.name ?? p.product_id}
                      </th>
                      <td>{p.diagnostics?.history_days ?? "—"} วัน</td>
                      <td>{p.model_version}</td>
                      <td>{p.diagnostics?.validation_origins ?? 0}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(result, null, 2)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = "forecast-analysis-" + result.cutoff + ".json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            ดาวน์โหลดผลวิเคราะห์ (JSON)
          </button>
        </>
      )}
    </details>
  );
}
