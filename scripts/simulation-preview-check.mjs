import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const latest = JSON.parse(
  await readFile(".local/simulation/latest.json", "utf8"),
);
assert(
  latest.synthetic &&
    /^coffee_sim_[0-9]{14}_[a-f0-9]{8}$/.test(latest.database),
);
const output = resolve(".local/simulation", latest.database);
const access = JSON.parse(
  await readFile(resolve(output, "review-access.json"), "utf8"),
);
const report = JSON.parse(
  await readFile(resolve(output, "report.json"), "utf8"),
);
assert(access.synthetic && report.synthetic);
const base = "http://localhost:3002";
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
});
try {
  const context = await browser.newContext({
    viewport: { width: 1536, height: 960 },
  });
  const login = await context.request.post(base + "/api/auth/login", {
    headers: { Origin: base },
    data: { email: access.email, password: access.password },
  });
  assert.equal(login.status(), 200);
  assert((await login.json()).user.name.includes("ข้อมูลจำลอง"));
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const checks = [];
  for (const [label, from, to, run] of [
    [
      "holdout",
      report.period.holdout_from,
      report.period.holdout_to,
      report.holdout_run_id,
    ],
    [
      "future",
      report.future_dates.from,
      report.future_dates.to,
      report.future_run_id,
    ],
  ]) {
    const response = await context.request.get(
      `${base}/api/forecasts?date_from=${from}&date_to=${to}&run_id=${run}&data_mode=actual`,
    );
    assert.equal(response.status(), 200);
    const data = await response.json();
    assert.equal(data.forecasts.length, 240);
    if (label === "holdout") {
      assert.equal(data.accuracy.samples, 240);
      assert(Math.abs(data.accuracy.mae - report.holdout_metrics.mae) < 1e-9);
    }
    await page.goto(
      `${base}/forecast?from=${from}&to=${to}&mode=actual&run=${run}`,
    );
    await expect(page.locator(".metrics")).toBeVisible();
    await expect(
      page.getByLabel("รอบพยากรณ์ที่แสดง", { exact: true }),
    ).toHaveValue(run);
    await expect(page.locator(".metrics")).toContainText(
      label === "holdout"
        ? new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(
            report.holdout_metrics.mae,
          )
        : "MAPE",
    );
    // Recharts animates the line for 1.5s after data arrives; capture its final frame.
    await page.waitForTimeout(1800);
    await page.screenshot({
      path: resolve(output, `synthetic-${label}-desktop.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".metrics")).toBeVisible();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: resolve(output, `synthetic-${label}-mobile.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1536, height: 960 });
    checks.push(
      label +
        ": 240 points, saved round, desktop/mobile, no horizontal overflow",
    );
  }
  assert.deepEqual(errors, []);
  await context.close();
  const result = {
    synthetic: true,
    passed: true,
    checks,
    runtime_errors: errors,
  };
  await writeFile(
    resolve(output, "preview-check.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
