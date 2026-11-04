import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { serializeForecastHistory } from "../dist/shop/forecast-snapshot.js";

// Browser plugin is unavailable; use installed Edge/Chromium. Only research writes are authorized here.
const coffee = process.argv.includes("--coffee");
const profile = coffee
  ? {
      source: "https://www.kaggle.com/datasets/ihelon/coffee-sales",
      cutoff: "2025-02-22",
      end: "2025-03-23",
      trainingTo: "2025-02-21",
      outlet: "index_1",
      expected: 240,
      invalidCutoff: "2025-03-10",
    }
  : {
      source: "https://data.mendeley.com/datasets/kcgf45y24m/2",
      cutoff: "2025-09-01",
      end: "2025-09-30",
      trainingTo: "2025-08-31",
      outlet: "SHOP001",
      expected: 2820,
      invalidCutoff: "2025-09-15",
    };
const base = process.env.APP_ORIGIN ?? "http://localhost:3001",
  output = resolve(
    coffee
      ? ".local/public-datasets/ihelon-coffee-sales/evidence"
      : ".local/public-datasets/evidence",
  );
await mkdir(output, { recursive: true });
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
async function operationalSnapshot() {
  const counts = (
    await db.query(
      "SELECT (SELECT count(*)::int FROM orders) AS orders,(SELECT count(*)::int FROM payments) AS payments,(SELECT count(*)::int FROM stock_movements) AS stock_movements,(SELECT count(*)::int FROM forecast_runs) AS forecast_runs,(SELECT count(*)::int FROM forecasts) AS forecast_cache,(SELECT count(*)::int FROM day_closings) AS day_closings",
    )
  ).rows[0];
  const stock = (
    await db.query(
      "SELECT id,current_stock,version FROM ingredients ORDER BY id",
    )
  ).rows;
  return { counts, stock };
}
const before = await operationalSnapshot();
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
try {
  const context = await browser.newContext({
    viewport: { width: 1536, height: 960 },
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
  });
  const login = await context.request.post(base + "/api/auth/login", {
    headers: { Origin: base },
    data: {
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
    },
  });
  assert.equal(login.status(), 200, "Owner login required");
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/forecast/replay");
  await expect(
    page.getByRole("heading", {
      name: "Historical Backtest (Public Dataset)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Dataset / Source", { exact: true }),
  ).toBeVisible();
  const imported = (
    await (await context.request.get(base + "/api/forecasts/datasets")).json()
  ).datasets;
  assert(
    imported.some((d) => d.metadata.doi === "10.17632/kcgf45y24m.2"),
    "Mendeley must remain available",
  );
  const selected = imported.find(
    (d) => d.metadata.source_url === profile.source,
  );
  assert(selected, "Requested imported dataset must exist");
  await page
    .getByLabel("Dataset / Source", { exact: true })
    .selectOption(selected.id);
  await page
    .getByLabel("วันเริ่มทดสอบ (as-of)", { exact: true })
    .fill(profile.cutoff);
  await page
    .getByLabel("สาขา / สตรีมข้อมูล", { exact: true })
    .selectOption(profile.outlet);
  await page.getByLabel("สินค้าในชุดข้อมูล", { exact: true }).selectOption("");
  const predicted = page.waitForResponse(
    (r) => r.url().endsWith("/api/forecasts/backtest"),
    { timeout: 190000 },
  );
  // Preserve the fixed-origin protocol of the existing evaluation evidence.
  await page.locator('select[name="replay_mode"]').selectOption("fixed");
  await page
    .getByRole("button", { name: "เริ่ม Historical Replay", exact: true })
    .click();
  const response = await predicted;
  assert.equal(response.status(), 200);
  const result = await response.json();
  assert.equal(result.kind, "historical_replay");
  assert.equal(result.data_mode, "PUBLIC_DATASET");
  assert.equal(result.run.cutoff, profile.cutoff);
  assert.equal(result.date_to, profile.end);
  assert.equal(result.run.metadata.training_to, profile.trainingTo);
  assert.equal(result.coverage.expected, profile.expected);
  assert.equal(result.score.samples, profile.expected);
  assert(
    result.run.input_history.every(
      (r) => r.date < result.run.cutoff && r.unit_price === 0,
    ),
  );
  assert.equal(
    createHash("sha256")
      .update(serializeForecastHistory(result.run.input_history))
      .digest("hex"),
    result.run.history_sha256,
  );
  await expect(
    page.getByRole("heading", { name: "Actual vs Forecast", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "คุณภาพยอดจริง", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("คะแนนรายสินค้า / วัน", { exact: true }),
  ).toBeVisible();
  for (const width of [1536, 390]) {
    await page.setViewportSize({ width, height: 960 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Replay page overflow",
    );
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    assert.deepEqual(
      axe.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      [],
    );
    await page.screenshot({
      path: resolve(output, `replay-${width}.png`),
      fullPage: true,
    });
    await page
      .locator(".chart-panel")
      .screenshot({ path: resolve(output, `replay-chart-${width}.png`) });
  }
  await page.getByText("คะแนนยอดรวมรายวัน", { exact: true }).click();
  await page
    .getByText("Model selected และคะแนนเลือกวิธีภายในช่วงฝึก", { exact: true })
    .click();
  const expanded = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(expanded.violations, []);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลดผล Replay (JSON)", exact: true })
    .click();
  const saved = resolve(output, "replay-ui.json");
  await (await download).saveAs(saved);
  assert.equal(JSON.parse(await readFile(saved, "utf8")).run.id, result.run.id);
  // Failure retains the previous saved result; retry with a valid shorter horizon.
  await page
    .getByLabel("วันเริ่มทดสอบ (as-of)", { exact: true })
    .fill(profile.invalidCutoff);
  const bad = page.waitForResponse((r) =>
    r.url().endsWith("/api/forecasts/backtest"),
  );
  await page
    .getByRole("button", { name: "เริ่ม Historical Replay", exact: true })
    .click();
  assert.equal((await bad).status(), 400);
  await expect(
    page.getByText(
      "เลือกวันเริ่มทดสอบหลังวันแรก และให้ช่วงทดสอบทั้งหมดอยู่ในช่วงข้อมูล",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByLabel("วันเริ่มทดสอบ (as-of)", { exact: true })
    .fill(profile.cutoff);
  await page.getByLabel("ระยะ Replay", { exact: true }).selectOption("1");
  const retry = page.waitForResponse(
    (r) => r.url().endsWith("/api/forecasts/backtest"),
    { timeout: 190000 },
  );
  await page
    .getByRole("button", { name: "เริ่ม Historical Replay", exact: true })
    .click();
  const retried = await retry;
  assert.equal(retried.status(), 200);
  const retryRun = await retried.json();
  await expect(
    page.getByLabel("รอบ Replay ที่บันทึก", { exact: true }),
  ).toHaveValue(retryRun.run.id);
  await page
    .getByLabel("รอบ Replay ที่บันทึก", { exact: true })
    .selectOption(result.run.id);
  await expect(
    page.getByRole("columnheader", { name: "Actual", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("ระยะ Replay", { exact: true })).toHaveValue(
    "30",
  );
  await page
    .getByText("แหล่งข้อมูล สิทธิ์ใช้งาน และข้อจำกัด", { exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: selected.metadata.license, exact: true }),
  ).toBeVisible();
  await page.getByLabel("สาขา / สตรีมข้อมูล", { exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  // Empty/no-dataset state is exercised without changing the database.
  await page.route("**/api/forecasts/datasets", (route) =>
    route.fulfill({ json: { datasets: [] } }),
  );
  await page.goto(base + "/forecast/replay");
  await expect(
    page.getByText(/ยังไม่มีชุดข้อมูลสาธารณะ กรุณานำเข้า/),
  ).toBeVisible();
  await page.unroute("**/api/forecasts/datasets");
  assert.deepEqual(errors, []);
  assert.deepEqual(
    await operationalSnapshot(),
    before,
    "Public replay changed operational data",
  );
  await writeFile(
    resolve(output, "browser-check.json"),
    JSON.stringify(
      {
        passed: true,
        score: result.score,
        aggregate_score: result.aggregate_score,
        coverage: result.coverage,
        run_id: result.run.id,
        operational_counts: before.counts,
        checks: [
          "Exclusive cutoff and input checksum",
          "Immutable saved rounds and exact actual matches",
          "Public data/source/license disclosure",
          "Desktop/mobile WCAG and keyboard",
          "JSON download",
          "Invalid period and valid retry",
          "Saved round restores scope",
          "Empty dataset state",
          "No operational sales, stock, closing or forecast changes",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        passed: true,
        run_id: result.run.id,
        score: result.score,
        aggregate_score: result.aggregate_score,
        operational_counts: before.counts,
        screenshots: output,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await db.end();
}
