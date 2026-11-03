import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import QRCode from "qrcode";
import { qrBrowserChecks } from "./qr-browser-checks.mjs";

// Browser plugin not available. Use installed Edge on Windows, Chromium in CI.
// All writes occur in a disposable PostgreSQL schema, never the shop's live tables.
const schema = "e2e_" + randomUUID().replaceAll("-", "");
const url = new URL(process.env.DATABASE_URL);
const root = new pg.Pool({ connectionString: url.toString() });
const port = Number(process.env.E2E_PORT ?? 3101);
const base = `http://localhost:${port}`;
const password = randomBytes(18).toString("base64url");
const output =
  process.env.QA_OUTPUT_DIR ?? join(tmpdir(), "coffee-backoffice-qa");
await mkdir(output, { recursive: true });
await root.query(`CREATE SCHEMA ${schema}`);
url.searchParams.set("options", "-csearch_path=" + schema);
const env = {
  ...process.env,
  DATABASE_URL: url.toString(),
  APP_ORIGIN: base,
  PUBLIC_ORIGIN: process.env.E2E_PUBLIC_HOST
    ? `http://${process.env.E2E_PUBLIC_HOST}:${port}`
    : base,
  PORT: String(port),
  NODE_ENV: "test",
  SEED_OWNER_EMAIL: "owner@example.com",
  SEED_OWNER_PASSWORD: password,
};
let child;
let browser;
const checks = [];
const pageErrors = [];
const consoleErrors = [];
try {
  for (const script of ["migrate", "seed", "demo"]) {
    const result = spawnSync(process.execPath, [`dist/${script}.js`], {
      env,
      encoding: "utf8",
    });
    if (result.status !== 0)
      throw new Error(`E2E setup ${script} failed: ${result.stderr}`);
  }
  child = spawn(process.execPath, ["dist/server.js"], {
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let serverError = "";
  child.stderr.on("data", (chunk) => {
    serverError += chunk.toString();
  });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(base + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, "E2E server failed to start: " + serverError);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : process.platform === "win32"
        ? { channel: "msedge" }
        : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1536, height: 960 },
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (message) => {
    if (
      ["error", "warning"].includes(message.type()) &&
      !/401|403|net::ERR_FAILED/.test(message.text())
    )
      consoleErrors.push(message.text());
  });
  async function login(p, email, pass = password) {
    await p.goto(base);
    await p.getByLabel("อีเมล", { exact: true }).fill(email);
    await p.getByLabel("รหัสผ่าน", { exact: true }).fill(pass);
    await p.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
    await p.locator(".sidebar").waitFor();
  }
  async function go(path) {
    await page.goto(base + path);
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.locator(".loading")).toHaveCount(0);
  }
  await login(page, "owner@example.com");
  // A non-real recipient fixture exists only in the disposable test schema.
  const tlv = (tag, value) =>
    tag + String(value.length).padStart(2, "0") + value;
  const qrBody =
    tlv("00", "01") +
    tlv("01", "11") +
    tlv("29", tlv("00", "A000000677010111") + tlv("01", "0066000000000")) +
    tlv("53", "764") +
    tlv("58", "TH") +
    "6304";
  let qrCrc = 0xffff;
  for (const c of qrBody) {
    qrCrc ^= c.charCodeAt(0) << 8;
    for (let b = 0; b < 8; b++)
      qrCrc = ((qrCrc << 1) ^ (qrCrc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  const qrImage = await QRCode.toBuffer(
    qrBody + qrCrc.toString(16).padStart(4, "0").toUpperCase(),
    { width: 500, margin: 4 },
  );
  assert.equal(
    (
      await context.request.put(base + "/api/payment-qr", {
        headers: { Origin: base, "Content-Type": "image/png" },
        data: qrImage,
      })
    ).status(),
    200,
  );
  await expect(page).toHaveTitle("ขายหน้าร้าน · Coffee Backoffice");
  await expect(
    page.getByRole("heading", { name: "ขายหน้าร้าน", exact: true }),
  ).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.locator(".product-tile")).toHaveCount(8);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".product-tile img")).toHaveCount(8);
  await page
    .locator(".product-tile img")
    .evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
  assert(
    await page
      .locator(".product-tile img")
      .evaluateAll((images) =>
        images.every(
          (img) =>
            img.naturalWidth > 0 && new URL(img.src).origin === location.origin,
        ),
      ),
    "Bundled menu photographs did not load locally",
  );
  await expect(
    page.getByRole("link", { name: /เครดิตภาพ|CC BY|ภาพต้นฉบับ/ }),
  ).toHaveCount(0);
  await page.route("**/menu/latte.jpg", (route) => route.abort("failed"));
  await page.reload();
  await expect(
    page
      .locator(".product-tile")
      .filter({ hasText: "ลาเต้" })
      .getByText("โหลดรูปไม่ได้", { exact: true }),
  ).toBeVisible();
  await page.unroute("**/menu/latte.jpg");
  await page.reload();
  await page
    .locator(".product-tile img")
    .evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
  checks.push(
    "Eight real local menu photographs, no credit UI and stable failed-image fallback",
  );
  checks.push("Login and desktop POS");
  await page.locator(".product-tile").filter({ hasText: "ลาเต้" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".product-tile").filter({ hasText: "ลาเต้" }),
  ).toBeFocused();
  await page.locator(".product-tile").filter({ hasText: "ลาเต้" }).click();
  await page.getByRole("radio", { name: /ไม่หวาน/ }).check();
  await page.getByRole("radio", { name: /นมโอ๊ต/ }).check();
  await page
    .getByRole("button", { name: "เพิ่ม / บันทึกเมนู", exact: true })
    .click();
  await page.screenshot({
    path: join(output, "pos-desktop.png"),
    fullPage: true,
  });
  let dropped = false;
  await page.getByRole("button", { name: "PromptPay", exact: true }).click();
  await expect(
    page.getByRole("img", {
      name: "QR PromptPay ของร้านสำหรับชำระเงิน",
      exact: true,
    }),
  ).toBeVisible();
  await page.locator(".promptpay-image").evaluate((img) => img.decode());
  await expect(page.locator(".promptpay-payment")).toContainText("฿90");
  await page.screenshot({
    path: join(output, "promptpay-pos.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "เงินสด", exact: true }).click();
  checks.push(
    "Configured PromptPay QR and current order amount appear before manual payment verification",
  );
  await page.route("**/api/orders", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "ยืนยันและรับชำระ", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "ยืนยันรับชำระ", exact: true })
    .click();
  await expect(page.getByText(/ยังยืนยันผลรายการไม่ได้/)).toBeVisible();
  await page.unroute("**/api/orders");
  await page
    .getByRole("button", { name: "ตรวจสอบและลองอีกครั้ง", exact: true })
    .click();
  await page.getByRole("link", { name: /ดูใบเสร็จ/ }).click();
  await expect(page.locator(".receipt")).toContainText("฿90");
  const orderId = new URL(page.url()).pathname.split("/").pop();
  await page.emulateMedia({ media: "print" });
  await page.screenshot({
    path: join(output, "receipt-print.png"),
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  checks.push("POS → payment → printable receipt");
  const qa = new pg.Pool({ connectionString: url.toString() });
  try {
    assert.equal(
      Number((await qa.query("SELECT count(*) FROM orders")).rows[0].count),
      1,
      "Uncertain retry duplicated the order",
    );
    for (const [name, expected] of [
      ["นมโอ๊ต", 850],
      ["นมสด", 4000],
      ["น้ำเชื่อม", 2000],
      ["เมล็ดกาแฟ", 1982],
    ]) {
      const result = await qa.query(
        "SELECT current_stock FROM ingredients WHERE name=$1",
        [name],
      );
      assert.equal(
        Number(result.rows[0].current_stock),
        expected,
        `Stock substitution ${name}`,
      );
    }
  } finally {
    await qa.end();
  }
  checks.push("Actual PostgreSQL stock and option substitutions");
  checks.push(
    "Lost payment response recovers without duplicate order or stock deduction",
  );
  await go("/kds");
  await expect(page.locator(".order-card")).toHaveCount(1);
  await page.getByRole("button", { name: "เริ่มทำ", exact: true }).click();
  await page.getByRole("button", { name: "เสร็จแล้ว", exact: true }).waitFor();
  await page.screenshot({
    path: join(output, "kds-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "เสร็จแล้ว", exact: true }).click();
  await expect(page.getByText("✓ รอแคชเชียร์ส่งมอบ")).toBeVisible();
  checks.push("KDS preparation, recipe and ready transitions");
  await go("/orders");
  await page.getByRole("button", { name: "เปิดออเดอร์", exact: true }).click();
  await page
    .getByRole("button", { name: "ส่งมอบให้ลูกค้าแล้ว", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "ยืนยันส่งมอบ", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").first().locator(".badge").first(),
  ).toContainText("ส่งมอบแล้ว");
  checks.push("Cashier completes ready order");
  await go("/reports");
  await page.getByRole("button", { name: "วันนี้", exact: true }).click();
  await expect(page.locator(".metrics")).toContainText("฿90");
  await page.screenshot({
    path: join(output, "reports-desktop.png"),
    fullPage: true,
  });
  checks.push("Reports reflect the real paid order");
  await go("/forecast");
  await expect(
    page
      .getByText("ต้องมี 28 วันใช้ได้ใน 56 วันล่าสุด และข้อมูลไม่เกิน 6 วัน")
      .first(),
  ).toBeVisible();
  await page
    .getByLabel("ข้อมูลที่ใช้สร้าง", { exact: true })
    .selectOption("mixed");
  await page.getByRole("button", { name: "แสดงผล", exact: true }).click();
  await page
    .getByRole("button", { name: "สร้างพยากรณ์ใหม่", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "สร้างผลพยากรณ์แล้ว" }),
  ).toBeVisible({ timeout: 20000 });
  await expect(
    page
      .getByText(
        /^(weekly-naive-v1|coffee-direct-v4-|ses-v1|mean-|weekday-mean-)/,
      )
      .first(),
  ).toBeAttached();
  await expect(
    page.getByText(/แถบช่วงค่ามาจากความคลาดเคลื่อนย้อนหลัง/).first(),
  ).toBeAttached();
  await expect(page.getByText("mock-weekday-v1", { exact: true })).toHaveCount(
    0,
  );
  checks.push("Live FastAPI forecast and replenishment UI");
  const availableRuns = page
    .getByLabel("รอบพยากรณ์ที่แสดง", { exact: true })
    .locator('option[value]:not([value=""])');
  await expect(availableRuns).toHaveCount(1);
  const savedRun = await availableRuns.first().getAttribute("value");
  assert(savedRun);
  await page
    .getByLabel("รอบพยากรณ์ที่แสดง", { exact: true })
    .selectOption(savedRun);
  await page.getByRole("button", { name: "แสดงผล", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ดาวน์โหลดรอบนี้ (JSON)", exact: true })
    .click();
  const downloaded = await downloadEvent;
  const roundFile = join(output, "forecast-round.json");
  await downloaded.saveAs(roundFile);
  const archivedRound = JSON.parse(await readFile(roundFile, "utf8"));
  assert.equal(archivedRound.run.id, savedRun);
  assert.equal(archivedRound.run.target_basis, "fulfilled_v1");
  assert.equal(archivedRound.run.data_mode, "mixed");
  assert.equal(archivedRound.points.length, 56);
  assert(archivedRound.run.input_history.length > 0);
  assert.match(archivedRound.run.history_sha256, /^[a-f0-9]{64}$/);
  await page
    .getByRole("button", { name: "สร้างพยากรณ์ใหม่", exact: true })
    .click();
  await expect(
    page
      .getByLabel("รอบพยากรณ์ที่แสดง", { exact: true })
      .locator('option[value]:not([value=""])'),
  ).toHaveCount(2);
  await expect(
    page.getByLabel("รอบพยากรณ์ที่แสดง", { exact: true }),
  ).toHaveValue(savedRun);
  checks.push(
    "Immutable forecast rounds, explicit demo mode, JSON snapshot export and preserved old selection",
  );
  await page
    .getByText("จำนวนเตรียมรายเมนูและเวอร์ชันโมเดล", { exact: true })
    .click();
  await expect(
    page.getByRole("columnheader", { name: "วิธีพยากรณ์", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: join(output, "forecast-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Forecast mobile page overflows",
  );
  const forecastAxe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(
    forecastAxe.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
    [],
    "Forecast accessibility violations",
  );
  await page.screenshot({
    path: join(output, "forecast-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1536, height: 960 });
  checks.push(
    "Adaptive forecast method/source disclosure, absent confidence bounds, mobile layout and accessibility",
  );
  await go("/menu?tab=categories");
  await page
    .getByRole("button", { name: "เพิ่มหมวดหมู่", exact: true })
    .click();
  await page.getByLabel("ชื่อหมวดหมู่", { exact: true }).fill("ทดสอบ QA");
  await page
    .getByRole("button", { name: "บันทึกหมวดหมู่", exact: true })
    .click();
  await expect(
    page.getByRole("rowheader", { name: "ทดสอบ QA", exact: true }),
  ).toBeVisible();
  await go("/menu");
  await page.getByRole("button", { name: "เพิ่มเมนู", exact: true }).click();
  await page.getByLabel("ชื่อเมนู", { exact: true }).fill("เมนู QA");
  await page
    .getByLabel("หมวดหมู่", { exact: true })
    .selectOption({ label: "ทดสอบ QA" });
  await page.getByLabel("ราคา (บาท)", { exact: true }).fill("45");
  await page.getByRole("button", { name: "บันทึกเมนู", exact: true }).click();
  await expect(
    page.getByRole("rowheader", { name: "เมนู QA", exact: true }),
  ).toBeVisible();
  const photoRow = page.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: "ลาเต้", exact: true }),
  });
  await photoRow.getByRole("button", { name: "แก้ไข", exact: true }).click();
  await expect(page.locator(".menu-photo-preview img")).toHaveAttribute(
    "src",
    "/menu/latte.jpg",
  );
  await page.getByRole("button", { name: "บันทึกเมนู", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Upload against the disposable schema, keeping shop records untouched.
  await photoRow.getByRole("button", { name: "แก้ไข", exact: true }).click();
  await page
    .getByLabel("เลือกรูปจากเครื่อง", { exact: true })
    .setInputFiles("client/public/menu/latte.jpg");
  await expect(page.locator(".menu-photo-preview img")).toHaveAttribute(
    "src",
    /^blob:/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".menu-photo-preview").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "menu-photo-upload-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1536, height: 960 });
  const imageUpload = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/menu-images") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "บันทึกเมนู", exact: true }).click();
  assert.equal((await imageUpload).status(), 201);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(photoRow.locator("img")).toHaveAttribute(
    "src",
    /^\/api\/menu-images\/[a-f0-9]{64}\.webp$/,
  );
  await photoRow.locator("img").evaluate((img) => img.decode());
  // Restore bundled fixture photo so later exact public-menu assertions remain useful.
  await photoRow.getByRole("button", { name: "แก้ไข", exact: true }).click();
  await page
    .getByLabel("ลิงก์รูปภาพ", { exact: false })
    .fill("/menu/latte.jpg");
  await page.getByRole("button", { name: "บันทึกเมนู", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  checks.push(
    "Local photo selection, mobile preview, safe upload and saved menu thumbnail",
  );
  checks.push("Category and product CRUD forms");
  await go("/forecast?mode=mixed");
  await page
    .getByLabel("เมนู", { exact: true })
    .selectOption({ label: "ลาเต้" });
  await page.getByRole("button", { name: "แสดงผล", exact: true }).click();
  await expect(
    page.getByText("สร้างเฉพาะเมนูที่กรองอยู่", { exact: true }),
  ).toBeVisible();
  const selectedForecast = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/forecasts/generate") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "สร้างพยากรณ์ใหม่", exact: true })
    .click();
  const selectedResponse = await selectedForecast;
  assert.equal(selectedResponse.status(), 200);
  assert.equal((await selectedResponse.json()).count, 7);
  assert(selectedResponse.request().postDataJSON().product_id);
  checks.push(
    "Selected-menu forecasting works while a new menu has no history",
  );
  await page
    .getByText("บันทึกวันที่ร้านหยุด สินค้าหมด หรือข้อมูลไม่ครบ", {
      exact: true,
    })
    .click();
  await page
    .getByLabel("เหตุผลหรือรายละเอียด", { exact: true })
    .fill("QA stockout annotation in isolated schema");
  await page
    .getByRole("button", { name: "บันทึกคุณภาพข้อมูล", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "บันทึกคุณภาพข้อมูลแล้ว" }),
  ).toBeVisible();
  await expect(
    page.getByText(/QA stockout annotation in isolated schema/),
  ).toBeVisible();
  checks.push(
    "Audited forecast-quality annotation through shared form in isolated schema",
  );
  await go("/inventory?tab=recipes");
  await page
    .getByLabel("เลือกเมนูเพื่อจัดการสูตร", { exact: true })
    .selectOption({ label: "เมนู QA" });
  await page
    .getByRole("button", { name: "เพิ่มวัตถุดิบ", exact: true })
    .click();
  await page
    .getByLabel("วัตถุดิบ", { exact: true })
    .selectOption({ label: "เมล็ดกาแฟ (g)" });
  await page.getByLabel("ปริมาณ", { exact: true }).fill("18");
  await page.getByRole("button", { name: "เพิ่มขั้นตอน", exact: true }).click();
  await page.getByLabel("คำแนะนำ", { exact: true }).fill("ชงตามสูตรตัวอย่าง");
  await page.getByRole("button", { name: "บันทึกสูตร", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "บันทึกสูตรแล้ว" }),
  ).toBeVisible();
  checks.push("Recipe ingredients and preparation-step editor");
  await go("/inventory");
  await page
    .getByRole("button", { name: "รับเข้า / ของเสีย", exact: true })
    .click();
  await page
    .getByLabel("วัตถุดิบ", { exact: true })
    .selectOption({ label: "เมล็ดกาแฟ (g)" });
  await page
    .getByLabel("จำนวน (หน่วยตามวัตถุดิบ)", { exact: true })
    .fill("100");
  await page.getByLabel("เหตุผล", { exact: true }).fill("รับของ QA");
  await page.getByRole("button", { name: "บันทึกรายการ", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "บันทึกสต็อกแล้ว" }),
  ).toBeVisible();
  checks.push("Stock receipt form");
  await go("/users");
  await page
    .getByRole("button", { name: "เพิ่มผู้ใช้งาน", exact: true })
    .click();
  await page.getByLabel("ชื่อผู้ใช้งาน", { exact: true }).fill("ผู้ใช้ QA");
  await page.getByLabel("อีเมล", { exact: true }).fill("qa@example.com");
  await page.getByLabel("รหัสผ่านเริ่มต้น", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "บันทึกผู้ใช้งาน", exact: true })
    .click();
  await expect(
    page.getByRole("rowheader", { name: "ผู้ใช้ QA", exact: true }),
  ).toBeVisible();
  checks.push("User creation");
  const staff = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const staffPage = await staff.newPage();
  await login(staffPage, "qa@example.com");
  await expect(staffPage.locator(".sidebar nav")).not.toContainText("รายงาน");
  await staffPage.goto(base + "/reports");
  await expect(
    staffPage.getByRole("heading", { name: "ไม่มีสิทธิ์เข้าถึงหน้านี้" }),
  ).toBeVisible();
  const forbidden = await staff.request.get(
    base + "/api/reports?date_from=2026-11-01&date_to=2026-11-02",
  );
  assert.equal(forbidden.status(), 403);
  await staffPage.goto(base + "/account");
  await staffPage
    .getByLabel("รหัสผ่านปัจจุบัน", { exact: true })
    .fill(password);
  await staffPage
    .getByLabel("รหัสผ่านใหม่", { exact: true })
    .fill("New-QA-password-123");
  await staffPage
    .getByLabel("ยืนยันรหัสผ่านใหม่", { exact: true })
    .fill("New-QA-password-123");
  await staffPage
    .getByRole("button", { name: "เปลี่ยนรหัสผ่าน", exact: true })
    .click();
  await expect(
    staffPage.getByRole("heading", { name: "เข้าสู่ระบบ", exact: true }),
  ).toBeVisible();
  await login(staffPage, "qa@example.com", "New-QA-password-123");
  await staff.close();
  checks.push("Cashier permissions and password/session lifecycle");
  const kitchenContext = await browser.newContext();
  const kitchenPage = await kitchenContext.newPage();
  await login(kitchenPage, "kitchen@example.com");
  await expect(kitchenPage.locator(".sidebar nav a")).toHaveCount(1);
  const data = await (
    await kitchenContext.request.get(base + "/api/kds")
  ).json();
  assert(!/price_satang|cost_satang|total_satang/.test(JSON.stringify(data)));
  await kitchenContext.close();
  checks.push("Kitchen-only navigation and financial-data isolation");
  await qrBrowserChecks({ browser, page, base, output, checks });
  await go("/pos");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(output, "pos-mobile.png"),
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile page overflows horizontally",
  );
  const axeMobile = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(
    axeMobile.violations.map((v) => ({
      id: v.id,
      description: v.description,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
    "Mobile accessibility violations",
  );
  await page.setViewportSize({ width: 1536, height: 960 });
  const axeDesktop = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  assert.deepEqual(
    axeDesktop.violations.map((v) => ({
      id: v.id,
      description: v.description,
      nodes: v.nodes.map((n) => n.target),
    })),
    [],
    "Desktop accessibility violations",
  );
  checks.push("390px responsive layout and automated WCAG checks");
  await page.getByRole("button", { name: "เพิ่มเมนู", exact: true }).count();
  await page.keyboard.press("Tab");
  assert(
    await page.evaluate(() => document.activeElement !== document.body),
    "Keyboard focus is missing",
  );
  assert.deepEqual(pageErrors, [], "Browser runtime errors");
  assert.deepEqual(
    consoleErrors,
    [],
    "Unexpected browser console errors or warnings",
  );
  checks.push("Keyboard focus and no runtime exceptions");
  console.log(
    JSON.stringify(
      {
        passed: true,
        checks,
        screenshots: output,
        orderId,
        isolated_schema: schema,
      },
      null,
      2,
    ),
  );
} finally {
  if (browser) await browser.close();
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await root.query(`DROP SCHEMA ${schema} CASCADE`);
  await root.end();
}
