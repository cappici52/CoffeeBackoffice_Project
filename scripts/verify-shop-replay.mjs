import "dotenv/config";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { connectDatabase } from "../dist/db.js";
import { metrics } from "../dist/shop/forecast-metrics.js";

const db = connectDatabase(process.env.DATABASE_URL);
try {
  const run = (
    await db.query(
      "SELECT * FROM shop_simulation_runs WHERE status='complete' ORDER BY completed_at DESC LIMIT 1",
    )
  ).rows[0];
  assert(run, "No completed main-shop replay");
  const output = resolve(".local/shop-replay", run.id);
  const report = JSON.parse(
    await readFile(resolve(output, "report.json"), "utf8"),
  );
  assert.equal(report.run_id, run.id);
  assert(report.synthetic && report.main_shop);
  const audit = await db.transaction(async (sql) => {
    await sql.query("SET TRANSACTION READ ONLY");
    return (
      await sql.query(
        `WITH expected AS (
      SELECT o.id AS order_id,(ingredient->>'ingredient_id')::uuid AS ingredient_id,
      CASE WHEN o.confirmed_at IS NOT NULL AND (o.status<>'cancelled' OR EXISTS(
        SELECT 1 FROM order_items started WHERE started.order_id=o.id AND started.started_at IS NOT NULL))
      THEN sum(i.qty*(ingredient->>'qty')::numeric) ELSE 0 END AS consumed
      FROM orders o JOIN order_items i ON i.order_id=o.id
      CROSS JOIN LATERAL jsonb_array_elements(i.ingredients) ingredient
      WHERE o.simulation_run_id=$1 GROUP BY o.id,ingredient->>'ingredient_id'
    ), journal AS (
      SELECT ref_order_id AS order_id,ingredient_id,-sum(qty) AS consumed FROM stock_movements
      WHERE simulation_run_id=$1 AND ref_order_id IS NOT NULL GROUP BY 1,2
    ), balances AS (
      SELECT balance_after,sum(qty) OVER(PARTITION BY ingredient_id ORDER BY created_at,id ROWS UNBOUNDED PRECEDING) AS calculated
      FROM stock_movements
    ) SELECT
      (SELECT count(*)::int FROM expected e FULL JOIN journal j USING(order_id,ingredient_id)
        WHERE abs(coalesce(e.consumed,0)-coalesce(j.consumed,0))>.0001) AS incorrect_recipe_consumption,
      (SELECT count(*)::int FROM balances WHERE abs(balance_after-calculated)>.0001) AS incorrect_running_balances,
      (SELECT count(*)::int FROM day_closings c WHERE c.simulation_run_id=$1 AND
        (c.summary->>'revenue_satang')::bigint<>(SELECT coalesce(sum(amount_satang),0) FROM payments p
         WHERE p.status='paid' AND (p.paid_at AT TIME ZONE 'Asia/Bangkok')::date=c.date)) AS incorrect_closed_revenue,
      (SELECT count(*)::int FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.simulation_run_id=$1 AND p.simulation_run_id IS DISTINCT FROM o.simulation_run_id) AS missing_payment_provenance,
      (SELECT count(*)::int FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.simulation_run_id=$1 AND i.completed_at<i.started_at) AS negative_preparation_times`,
        [run.id],
      )
    ).rows[0];
  });
  for (const [name, value] of Object.entries(audit))
    assert.equal(value, 0, "Audit failed: " + name);
  const rows = (
    await db.query(
      `WITH delivered AS (
    SELECT (o.completed_at AT TIME ZONE 'Asia/Bangkok')::date AS date,i.product_id,sum(i.qty)::int AS qty
    FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.simulation_run_id=$1 AND o.completed_at IS NOT NULL GROUP BY 1,2)
    SELECT c.date::text,p.id AS product_id,p.name,coalesce(d.qty,0)::int AS qty
    FROM day_closings c JOIN shop_simulation_products sp ON sp.run_id=c.simulation_run_id JOIN products p ON p.id=sp.product_id
    LEFT JOIN delivered d ON d.date=c.date AND d.product_id=p.id WHERE c.simulation_run_id=$1 ORDER BY c.date,p.name`,
      [run.id],
    )
  ).rows;
  assert.equal(rows.length, 211 * report.menus.length);
  const frozen = JSON.parse(
    await readFile(resolve(output, "frozen-holdout.json"), "utf8"),
  );
  const lookup = new Map(
    rows.map((row) => [row.date + ":" + row.product_id, row]),
  );
  const perMenu = report.menus.map((menu) => {
    const points = frozen.points.filter((p) => p.product_id === menu.id);
    return {
      name: menu.name,
      models: [...new Set(points.map((p) => p.model_version))],
      ...metrics(
        points.map((p) => ({
          actual: lookup.get(p.date + ":" + p.product_id).qty,
          predicted: Number(p.predicted_qty),
        })),
      ),
    };
  });
  const csv =
    [
      "date,product_id,product_name,qty,simulation_run_id,data_origin",
      ...rows.map((row) =>
        [
          row.date,
          row.product_id,
          JSON.stringify(row.name),
          row.qty,
          run.id,
          "synthetic-main-shop",
        ].join(","),
      ),
    ].join("\n") + "\n";
  await writeFile(resolve(output, "daily-211-days.csv"), csv);
  const verification = {
    synthetic: true,
    main_shop: true,
    run_id: run.id,
    audit,
    export_rows: rows.length,
    per_menu: perMenu,
  };
  await writeFile(
    resolve(output, "verification.json"),
    JSON.stringify(verification, null, 2),
  );
  const n = (value) => (value === null ? "—" : Number(value).toFixed(2));
  const markdown = `# ผลจำลองการขายในฐานข้อมูลหลัก

ใช้เมนู ราคา ตัวเลือก สูตร และวัตถุดิบเดิมของร้าน ผ่าน API จริงของแอป ข้อมูลขายที่สร้างขึ้นเป็นการจำลอง ไม่ใช่ลูกค้าหรือเงินรับจริง

ช่วง ${report.date_from} – ${report.date_to}: 211 วัน / ${report.menus.length} เมนู

- ส่งมอบสำเร็จ ${report.counters.completed.toLocaleString()} ออเดอร์ ผ่าน API ${report.api_calls.toLocaleString()} ครั้ง
- QR ${report.counters.qr.toLocaleString()} / POS ${report.counters.pos.toLocaleString()}
- ปิดวัน ${report.counters.closed_days} วัน; รายการเดิม/เมนู/สูตร/ตัวเลือก/โต๊ะตรวจ hash ตรงก่อนและหลัง
- ตรวจการใช้สูตรรายออเดอร์ ยอด stock ทุกการเคลื่อนไหว ยอดปิดวัน การติด provenance และเวลาเตรียม: พบคลาดเคลื่อน 0

ช่วงทดสอบ ${report.holdout_dates.from} – ${report.holdout_dates.to}: เก็บพยากรณ์ก่อนสร้างคำตอบ 30 วัน

| วิธี | MAE (หน่วย/เมนู/วัน) | RMSE | WAPE (%) |
|---|---:|---:|---:|
| แอปเลือกโมเดลรายเมนู | ${n(report.holdout_metrics.mae)} | ${n(report.holdout_metrics.rmse)} | ${n(report.holdout_metrics.wape)} |
| ยอดซ้ำสัปดาห์ก่อน | ${n(report.weekly_metrics.mae)} | ${n(report.weekly_metrics.rmse)} | ${n(report.weekly_metrics.wape)} |

| เมนูเดิมของร้าน | MAE | WAPE (%) | โมเดล |
|---|---:|---:|---|
${perMenu.map((m) => `| ${m.name} | ${n(m.mae)} | ${n(m.wape)} | ${m.models.join(", ")} |`).join("\n")}

พยากรณ์รอบถัดไป ${report.future_dates.from} – ${report.future_dates.to} อยู่ในแอปหลัก พอร์ต 3001 ใช้บัญชีร้านเดิม ผลทดสอบจำลองแสดงแยกจากคะแนนยอดขายปกติ แม้ API ใช้ data_mode=actual อ่าน order ledger

ฐานข้อมูลหลักมีรายงานขาย/รับชำระ/stock ที่สร้างโดยการจำลองแล้ว ไม่ใช่ฐานร้านที่มีเฉพาะรายการลูกค้าจริง เก็บ backup ก่อนเริ่มไว้ที่โฟลเดอร์ backup ของรอบนี้ ห้าม restore ทับฐานหลักอัตโนมัติ
`;
  await writeFile(resolve(output, "report.md"), markdown);
  console.log(JSON.stringify(verification, null, 2));
} finally {
  await db.close();
}
