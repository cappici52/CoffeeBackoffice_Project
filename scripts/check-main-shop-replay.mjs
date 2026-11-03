import "dotenv/config";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Browser plugin not available; use installed Edge/Chromium for the real app.
const latest = JSON.parse(
  await readFile(".local/shop-replay/latest.json", "utf8"),
);
assert(
  latest.main_shop && latest.synthetic && /^[a-f0-9-]{36}$/.test(latest.run_id),
);
const output = resolve(".local/shop-replay", latest.run_id);
const report = JSON.parse(
  await readFile(resolve(output, "report.json"), "utf8"),
);
const base = process.env.APP_ORIGIN ?? "http://localhost:3001";
assert.equal(new URL(base).port, "3001", "Main application required");
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
  assert.equal(login.status(), 200, "Use unchanged shop owner account");
  const shop = await context.request.get(base + "/api/shop-context");
  assert.equal(shop.status(), 200);
  assert((await shop.json()).contains_simulation);
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const checks = [];
  for (const [name, range, run] of [
    ["holdout", report.holdout_dates, report.holdout_run_id],
    ["future", report.future_dates, report.future_run_id],
  ]) {
    const response = await context.request.get(
      `${base}/api/forecasts?date_from=${range.from}&date_to=${range.to}&run_id=${run}&data_mode=actual`,
    );
    assert.equal(response.status(), 200);
    const data = await response.json();
    assert.equal(data.forecasts.length, report.menus.length * 30);
    assert(data.contains_simulated_sales);
    if (name === "holdout") {
      const score = data.evaluation.by_source.find(
        (s) => s.source === "simulation",
      );
      assert.equal(score.samples, report.menus.length * 30);
      assert(Math.abs(score.mae - report.holdout_metrics.mae) < 1e-9);
      const horizons = data.evaluation.by_horizon.filter(
        (s) => s.source === "simulation",
      );
      assert.deepEqual(
        horizons.map((s) => s.samples),
        [8, 56, 240],
      );
      const monthly = horizons.find((s) => s.horizon === 30);
      assert.equal(monthly.baseline.samples, 240);
      assert(Math.abs(monthly.baseline.mae - report.weekly_metrics.mae) < 1e-9);
      assert(
        Math.abs(monthly.paired_model.mae - report.holdout_metrics.mae) < 1e-9,
      );
      assert.equal(
        data.recommendations.length,
        0,
        "Historical targets must not reduce present inventory",
      );
      assert.equal(data.accuracy.samples, 0);
    }
    await page.goto(
      `${base}/forecast?from=${range.from}&to=${range.to}&mode=actual&run=${run}`,
    );
    await expect(
      page.getByRole("heading", { name: "พยากรณ์", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(".notice")
        .filter({ hasText: "ฐานข้อมูลนี้มีรายการจำลองการขาย" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("รอบพยากรณ์ที่แสดง", { exact: true }),
    ).toHaveValue(run);
    await expect(page.locator(".metrics").first()).toBeVisible();
    if (name === "holdout")
      await expect(
        page.getByText("คะแนนชุดจำลอง · แยกจากยอดปกติ", { exact: true }),
      ).toBeVisible();
    if (name === "holdout") {
      for (const [label, key] of [
        ["Bias", "bias"],
        ["RMSE", "rmse"],
        ["MAE", "mae"],
        ["WAPE", "wape"],
      ]) {
        const value =
          new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(
            report.holdout_metrics[key],
          ) + (label === "MAPE" || label === "WAPE" ? "%" : "");
        await expect(
          page
            .locator(".metrics > div")
            .filter({ has: page.getByText(label, { exact: true }) })
            .locator("strong"),
        ).toHaveText(value);
      }
      await page
        .getByLabel("คะแนนที่แสดง", { exact: true })
        .selectOption("actual");
      await expect(
        page
          .locator(".metrics > div")
          .filter({ has: page.getByText("MAE", { exact: true }) })
          .locator("strong"),
      ).toHaveText("—");
      await page
        .getByLabel("คะแนนที่แสดง", { exact: true })
        .selectOption("auto");
    } else
      await expect(
        page.getByText("ยังไม่มีคู่ข้อมูลสำหรับคะแนนที่เลือก", {
          exact: false,
        }),
      ).toBeVisible();
    await page.waitForTimeout(1800); // Recharts' known 1.5s line animation.
    await page.screenshot({
      path: resolve(output, `main-${name}-desktop.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: resolve(output, `main-${name}-mobile.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1536, height: 960 });
    checks.push(
      name +
        ": main app, 240 points, marked simulation, saved round, desktop/mobile",
    );
  }
  const accessibility = await new AxeBuilder({ page })
    .include("#content")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.deepEqual(
    accessibility.violations,
    [],
    "Forecast accessibility regression",
  );
  await page
    .getByLabel("เมนู", { exact: true })
    .selectOption(report.menus[0].id);
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/api/forecasts?") && r.url().includes("product_id="),
  );
  await page.getByRole("button", { name: "แสดงผล", exact: true }).click();
  assert.equal((await (await response).json()).forecasts.length, 30);
  await page.goto(base + "/forecast");
  await expect(page.locator(".metrics").first()).toBeVisible();
  await expect(page.locator(".chart-panel")).toContainText("ไม่มีข้อมูล");
  await page.waitForTimeout(1800);
  await page.screenshot({
    path: resolve(output, "main-default-forecast-fixed.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "ดูผลทดสอบย้อนหลัง 30 วัน", exact: true })
    .click();
  await expect(
    page.getByLabel("รอบพยากรณ์ที่แสดง", { exact: true }),
  ).toHaveValue(report.holdout_run_id);
  await expect(
    page
      .locator(".metrics > div")
      .filter({ has: page.getByText("MAE", { exact: true }) })
      .locator("strong"),
  ).toHaveText(
    new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(
      report.holdout_metrics.mae,
    ),
  );
  checks.push(
    "1/7/30-day cumulative evaluation and frozen weekly baseline match independent replay report; historical targets excluded from purchasing",
    "All four metric cards follow the chosen source; future scores stay unavailable; missing-day note and historical-test shortcut work",
  );
  await page.goto(base + "/forecast");
  await page.getByLabel("ดูรายเดือน", { exact: true }).fill("2026-04");
  await page.getByRole("button", { name: "แสดงเดือนนี้", exact: true }).click();
  await expect(page).toHaveURL(/from=2026-04-01.*to=2026-04-30/);
  const monthlyResponse = await context.request.get(
    base +
      "/api/forecasts?date_from=2026-04-01&date_to=2026-04-30&data_mode=actual",
  );
  const monthly = await monthlyResponse.json();
  assert.equal(
    monthly.actual.length,
    26 * report.menus.length,
    "April 5-30 is available beyond the 120-day training window",
  );
  assert(monthly.actual.every((a) => a.is_closed && a.simulated));
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ส่งออก CSV ตามช่วงที่เลือก", exact: true })
    .click();
  const download = await downloadPromise;
  assert.equal(
    download.suggestedFilename(),
    "sales-forecast-2026-04-01-2026-04-30.csv",
  );
  const csv = await readFile(await download.path(), "utf8");
  assert(csv.startsWith("\uFEFF"));
  assert.equal(csv.trim().split("\r\n").length, 1 + 30 * report.menus.length);
  assert(csv.includes('"simulation"') && csv.includes('"unknown"'));
  await page
    .getByRole("button", { name: "เดือนก่อนหน้า", exact: true })
    .click();
  await expect(page).toHaveURL(/from=2026-03-01.*to=2026-03-31/);
  await page.getByRole("button", { name: "เดือนถัดไป", exact: true }).click();
  await expect(page).toHaveURL(/from=2026-04-01.*to=2026-04-30/);
  await expect(
    page.getByLabel("พยากรณ์ล่วงหน้า", { exact: true }).locator("option"),
  ).toHaveText(["1 วัน", "7 วัน", "30 วัน"]);
  for (const width of [1536, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(page.getByLabel("ดูรายเดือน", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "ส่งออก CSV ตามช่วงที่เลือก",
        exact: true,
      }),
    ).toBeVisible();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: resolve(output, `forecast-month-${width}.png`),
      fullPage: true,
    });
  }
  checks.push(
    "Monthly history beyond 120 days, previous/next months, UTF-8 CSV with missing-day/source metadata, 1/7/30-day options and mobile layout",
  );
  const available = await (
    await context.request.get(
      `${base}/api/forecasts?date_from=${report.future_dates.from}&date_to=${report.future_dates.to}`,
    )
  ).json();
  const newest = available.runs.find(
    (r) =>
      r.input_quality?.pipeline === "coffee-demand-v5" &&
      (Date.parse(r.date_to) - Date.parse(r.date_from)) / 86400000 === 29,
  );
  assert(
    newest,
    "Generate a new v5 auto 30-day round before running this main-shop check",
  );
  const fresh = await (
    await context.request.get(base + "/api/forecasts/runs/" + newest.id)
  ).json();
  assert(
    fresh.points.every((p) => p.lower_qty !== null && p.upper_qty !== null),
  );
  const targets = fresh.points.map((p) => p.date).sort();
  const v5url = `${base}/forecast?from=${targets[0]}&to=${targets.at(-1)}&run=${newest.id}&cohort=simulation`;
  await page.goto(v5url);
  await expect(
    page.getByLabel("วิธีสำหรับรอบใหม่", { exact: true }),
  ).toHaveValue("auto");
  await expect(
    page.getByText("ประเมินความแม่นยำ", { exact: true }),
  ).toBeVisible();
  await page.getByText("ประเมินความแม่นยำ", { exact: true }).click();
  await expect(page.getByText(/ไม่ยืมคะแนนของรุ่นเดิมมาแสดง/)).toBeVisible();
  await page.getByText("ชุดข้อมูลและคุณภาพประวัติ", { exact: true }).click();
  await expect(page.getByLabel("ชุดข้อมูลฝึก", { exact: true })).toHaveValue(
    "simulation",
  );
  await page
    .getByText("จำนวนเตรียมรายเมนูและเวอร์ชันโมเดล", { exact: true })
    .click();
  await expect(
    page.getByRole("columnheader", { name: "วิธีพยากรณ์", exact: true }),
  ).toBeVisible();
  for (const width of [1536, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(
      page.getByRole("button", {
        name: "ส่งออก CSV ตามช่วงที่เลือก",
        exact: true,
      }),
    ).toBeVisible();
    const violations = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    assert.deepEqual(
      violations.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })),
      [],
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: resolve(output, `forecast-v5-${width}.png`),
      fullPage: true,
    });
    await page
      .locator(".chart-panel")
      .screenshot({ path: resolve(output, `forecast-v5-chart-${width}.png`) });
  }
  await page
    .getByText("ทดสอบย้อนหลังโดยกำหนดวันตัดข้อมูล", { exact: true })
    .click();
  await page
    .getByLabel("ใช้ข้อมูลถึงวันที่", { exact: true })
    .fill("2026-10-02");
  const analysisResponse = page.waitForResponse((r) =>
    r.url().endsWith("/api/forecasts/backtest"),
  );
  await page
    .getByRole("button", { name: "วิเคราะห์ย้อนหลัง", exact: true })
    .click();
  const analysis = await (await analysisResponse).json();
  assert.equal(analysis.kind, "backtest");
  assert.equal(analysis.score.samples, 240);
  assert.equal(analysis.date_from, "2026-10-03");
  assert.equal(analysis.date_to, "2026-11-01");
  await expect(page.getByText(/ผลวิเคราะห์ย้อนหลัง ·/)).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "ดาวน์โหลดผลวิเคราะห์ (JSON)",
      exact: true,
    }),
  ).toBeVisible();
  for (const width of [1536, 390]) {
    await page.setViewportSize({ width, height: 960 });
    const a11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    assert.deepEqual(
      a11y.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })),
      [],
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: resolve(output, `forecast-backtest-${width}.png`),
      fullPage: true,
    });
  }
  checks.push(
    "Cutoff-based retrospective analysis, 240 scored pairs, separate result/export, desktop/mobile accessibility",
  );
  await page
    .getByLabel("ชุดข้อมูลฝึก", { exact: true })
    .selectOption("genuine");
  await expect(
    page.getByText("ไม่มีข้อมูลล่าสุดสำหรับพยากรณ์", { exact: true }).first(),
  ).toBeVisible();
  const rejected = page.waitForResponse((r) =>
    r.url().endsWith("/api/forecasts/generate"),
  );
  await page
    .getByRole("button", { name: "สร้างพยากรณ์ใหม่", exact: true })
    .click();
  assert.equal(
    (await rejected).status(),
    409,
    "Explicit genuine request never falls back to generated sales",
  );
  await expect(page.getByText(/บางเมนูไม่มีประวัติที่ใช้ได้/)).toBeVisible();
  checks.push(
    "V5 automatic selection, source-cohort controls, calibrated bounds, prospective monitor, desktop/mobile accessibility and explicit genuine-data failure",
  );
  for (const route of ["/orders", "/inventory", "/reports"]) {
    await page.goto(base + route);
    await expect(
      page
        .locator(".notice")
        .filter({ hasText: "ฐานข้อมูลนี้มีรายการจำลองการขาย" }),
    ).toBeVisible();
  }
  assert.deepEqual(errors, []);
  const result = {
    main_shop: true,
    synthetic: true,
    passed: true,
    checks: [
      ...checks,
      "Menu filter returns 30 points",
      "Orders/inventory/reports show shared disclosure",
      "No page exceptions; automated forecast accessibility passed",
    ],
    run_id: latest.run_id,
  };
  await writeFile(
    resolve(output, "browser-check.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  await context.close();
} finally {
  await browser.close();
}
