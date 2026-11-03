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
    await expect(page.locator(".metrics")).toBeVisible();
    if (name === "holdout")
      await expect(
        page.locator(".notice").filter({ hasText: "ผลทดสอบจากการจำลอง:" }),
      ).toContainText(String(report.menus.length * 30));
    if (name === "holdout") {
      for (const [label, key] of [
        ["MAPE", "mape"],
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
  await expect(page.locator(".metrics")).toBeVisible();
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
    "All four metric cards follow the chosen source; future scores stay unavailable; missing-day note and historical-test shortcut work",
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
