import "dotenv/config";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { connectDatabase } from "../dist/db.js";
import { metrics } from "../dist/shop/forecast-metrics.js";
import { sandboxUrl } from "./simulation-plan.mjs";

// Read only from a completed, marked sandbox. No arbitrary target/path arguments.
const latest = JSON.parse(
  await readFile(".local/simulation/latest.json", "utf8"),
);
assert.equal(latest.synthetic, true);
const output = resolve(".local/simulation", latest.database);
const report = JSON.parse(
  await readFile(resolve(output, "report.json"), "utf8"),
);
assert.equal(report.synthetic, true);
assert.equal(report.database, latest.database);
const db = connectDatabase(
  sandboxUrl(process.env.DATABASE_URL, latest.database),
);
try {
  const marker = (await db.query("SELECT kind FROM simulation_metadata")).rows;
  assert.equal(marker.length, 1);
  assert.equal(marker[0].kind, "synthetic-only");
  const audit = await db.transaction(async (sql) => {
    await sql.query("SET TRANSACTION READ ONLY");
    return (
      await sql.query(`WITH expected AS (
      SELECT o.id AS order_id,(ingredient->>'ingredient_id')::uuid AS ingredient_id,
      CASE WHEN o.confirmed_at IS NOT NULL AND
        (o.status<>'cancelled' OR EXISTS(SELECT 1 FROM order_items started WHERE started.order_id=o.id AND started.started_at IS NOT NULL))
      THEN sum(i.qty*(ingredient->>'qty')::numeric) ELSE 0 END AS consumed
      FROM orders o JOIN order_items i ON i.order_id=o.id
      CROSS JOIN LATERAL jsonb_array_elements(i.ingredients) ingredient
      GROUP BY o.id,ingredient->>'ingredient_id'
    ), journal AS (
      SELECT ref_order_id AS order_id,ingredient_id,-sum(qty) AS consumed
      FROM stock_movements WHERE ref_order_id IS NOT NULL GROUP BY 1,2
    ) SELECT
      (SELECT count(*)::int FROM expected e FULL JOIN journal j USING(order_id,ingredient_id)
       WHERE coalesce(e.consumed,0)<>coalesce(j.consumed,0)) AS incorrect_order_consumption,
      (SELECT count(*)::int FROM day_closings c WHERE (c.summary->>'revenue_satang')::bigint <>
       (SELECT coalesce(sum(p.amount_satang),0) FROM payments p WHERE p.status='paid' AND (p.paid_at AT TIME ZONE 'Asia/Bangkok')::date=c.date)) AS incorrect_closed_revenue,
      (SELECT count(*)::int FROM order_items WHERE completed_at<started_at) AS negative_preparation_times`)
    ).rows[0];
  });
  assert.equal(
    audit.incorrect_order_consumption,
    0,
    "Per-order recipe/stock journal mismatch",
  );
  assert.equal(
    audit.incorrect_closed_revenue,
    0,
    "Closed day/payment journal mismatch",
  );
  assert.equal(audit.negative_preparation_times, 0);
  for (const counter of [
    "qr",
    "pos",
    "refunds",
    "stockouts",
    "cancelled_pending",
    "cancelled_confirmed",
    "cancelled_started",
    "unpaid_close_blocked",
  ])
    assert(report.counters[counter] > 0, "Missing scenario: " + counter);
  const rows = await db.transaction(async (sql) => {
    await sql.query("SET TRANSACTION READ ONLY");
    return (
      await sql.query(`WITH delivered AS (
      SELECT (o.completed_at AT TIME ZONE 'Asia/Bangkok')::date AS date,i.product_id,
      sum(i.qty)::int AS qty,sum(i.qty::bigint*i.unit_price_satang) AS revenue
      FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.completed_at IS NOT NULL GROUP BY 1,2)
      SELECT c.date::text,p.id AS product_id,p.name,coalesce(d.qty,0)::int AS qty,
      CASE WHEN coalesce(d.qty,0)>0 THEN d.revenue/d.qty/100.0 ELSE p.price_satang/100.0 END AS unit_price
      FROM day_closings c CROSS JOIN products p LEFT JOIN delivered d ON d.date=c.date AND d.product_id=p.id
      ORDER BY c.date,p.name`)
    ).rows;
  });
  assert.equal(rows.length, 211 * 8);
  const csv =
    [
      "date,product_id,product_name,qty,unit_price,data_origin",
      ...rows.map((row) =>
        [
          row.date,
          row.product_id,
          JSON.stringify(row.name),
          row.qty,
          row.unit_price,
          "synthetic",
        ].join(","),
      ),
    ].join("\n") + "\n";
  await writeFile(resolve(output, "daily-full.csv"), csv);
  const frozen = JSON.parse(
    await readFile(resolve(output, "frozen-holdout-forecast.json"), "utf8"),
  );
  const lookup = new Map(
    rows.map((row) => [row.date + ":" + row.product_id, row]),
  );
  const comparisons = frozen.points.map((point) => ({
    ...point,
    actual: lookup.get(point.date + ":" + point.product_id).qty,
    predicted: Number(point.predicted_qty),
  }));
  const perProduct = [...new Set(comparisons.map((p) => p.product_id))].map(
    (id) => {
      const pairs = comparisons.filter((p) => p.product_id === id);
      return {
        product: rows.find((row) => row.product_id === id).name,
        models: [...new Set(pairs.map((p) => p.model_version))],
        actual: pairs.reduce((s, p) => s + p.actual, 0),
        predicted: pairs.reduce((s, p) => s + p.predicted, 0),
        ...metrics(pairs),
      };
    },
  );
  const horizons = [1, 7, 14, 30].map((days) => ({
    days,
    ...metrics(comparisons.filter((point) => point.lead_days <= days)),
  }));
  const details = {
    synthetic: true,
    production_accuracy_claim: false,
    audit,
    full_export_sha256: createHash("sha256").update(csv).digest("hex"),
    per_product: perProduct,
    cumulative_horizons: horizons,
  };
  await writeFile(
    resolve(output, "evaluation-details.json"),
    JSON.stringify(details, null, 2),
  );
  const value = (n) => (n === null ? "n/a" : Number(n).toFixed(2));
  const markdown = `# ผลทดลองขายจำลอง — ไม่ใช่ข้อมูลลูกค้าจริง

ช่วง ${report.period.from} ถึง ${report.period.to}: 211 วัน, 8 เมนู

ทดสอบผ่าน API ${report.api_calls.toLocaleString()} ครั้ง: ส่งมอบ ${report.counters.completed.toLocaleString()} ออเดอร์, QR ${report.counters.qr.toLocaleString()} ออเดอร์, POS ${report.counters.pos.toLocaleString()} ออเดอร์

เก็บพยากรณ์ก่อนสร้างยอดช่วงทดสอบ ${report.period.holdout_from} ถึง ${report.period.holdout_to} รวม 30 วัน / 240 คู่เมนู-วัน ไม่ปรับโมเดลตามคำตอบช่วงทดสอบ

| วิธี | MAE (ชิ้น/เมนู/วัน) | RMSE | WAPE (%) |
|---|---:|---:|---:|
| ระบบเลือกโมเดลของแอป | ${value(report.holdout_metrics.mae)} | ${value(report.holdout_metrics.rmse)} | ${value(report.holdout_metrics.wape)} |
| ใช้ยอดซ้ำสัปดาห์ก่อน | ${value(report.weekly_baseline_metrics.mae)} | ${value(report.weekly_baseline_metrics.rmse)} | ${value(report.weekly_baseline_metrics.wape)} |

| เมนู | ส่งมอบจริงในข้อมูลจำลอง | พยากรณ์รวม | MAE | WAPE (%) | โมเดล |
|---|---:|---:|---:|---:|---|
${perProduct.map((p) => `| ${p.product} | ${p.actual} | ${value(p.predicted)} | ${value(p.mae)} | ${value(p.wape)} | ${p.models.join(", ")} |`).join("\n")}

ยอดค้างชำระ ${report.reconciliation.unpaid}, ออเดอร์ค้าง ${report.reconciliation.open_orders}, ยอดรับเงินไม่ตรงบิล ${report.reconciliation.incorrect_payments}, ยอดสต็อกไม่ตรงบัญชีเคลื่อนไหว ${report.reconciliation.incorrect_stock}; ปิดวันครบ ${report.reconciliation.closed_days} วัน ฐานข้อมูลร้านจริงไม่เปลี่ยนระหว่างรัน

มีพยากรณ์ถัดไป ${report.future_dates.from} ถึง ${report.future_dates.to} อีก 240 จุดใน future-30-days.json; ข้อมูลเต็ม 1,688 แถวอยู่ใน daily-full.csv ส่วน daily.csv เป็นประวัติล่าสุด 120 วันตามขีดจำกัดที่โมเดลใช้

ข้อมูลนี้สร้างด้วยกติกาและ seed ที่ประกาศล่วงหน้า สูตรวัตถุดิบเป็นสูตรทดสอบแบบย่อ และใช้เวลาจำลอง ไม่ได้ทดสอบเครือข่ายมือถือจริง เครื่องพิมพ์จริง หรือโอนเงิน PromptPay จริง ผลทดสอบนี้ยืนยันการทำงานกับสถานการณ์จำลองเท่านั้น ยังไม่ยืนยันความแม่นยำกับร้านจริง
`;
  await writeFile(resolve(output, "report.md"), markdown);
  console.log("Synthetic report and full 211-day export ready: " + output);
} finally {
  await db.close();
}
