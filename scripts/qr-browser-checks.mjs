import assert from "node:assert/strict";
import { join } from "node:path";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import jsQR from "jsqr";
import png from "pngjs";

export async function qrBrowserChecks({ browser, page, base, output, checks }) {
  await page.goto(base + "/tables");
  await page.getByRole("button", { name: "เพิ่มโต๊ะ", exact: true }).click();
  await page.getByLabel("หมายเลข / ชื่อโต๊ะ", { exact: true }).fill("1");
  await page.getByRole("button", { name: "บันทึกโต๊ะ", exact: true }).click();
  await page
    .getByRole("button", { name: "ดู / พิมพ์ QR", exact: true })
    .click();
  const qrImage = page.getByRole("img", {
    name: "QR สำหรับโต๊ะ 1",
    exact: true,
  });
  await expect(qrImage).toBeVisible();
  const menuUrl = await page
    .getByRole("link", { name: "เปิดเมนูลูกค้า", exact: true })
    .getAttribute("href");
  assert(menuUrl, "QR menu URL missing");
  const data = await qrImage.getAttribute("src");
  const image = png.PNG.sync.read(Buffer.from(data.split(",")[1], "base64"));
  const decoded = jsQR(
    new Uint8ClampedArray(image.data),
    image.width,
    image.height,
  );
  assert.equal(
    decoded?.data,
    menuUrl,
    "QR image did not decode to the table menu URL",
  );
  await page.emulateMedia({ media: "print" });
  await page.screenshot({
    path: join(output, "table-qr-print.png"),
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  checks.push(
    "Table creation, QR generation/decoding and printable table sign",
  );
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
  });
  const customer = await context.newPage();
  const errors = [];
  const unexpected = [];
  customer.on("pageerror", (error) => errors.push(error.message));
  customer.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/") && !pathname.startsWith("/api/guest/"))
      unexpected.push(pathname);
  });
  try {
    await customer.goto(menuUrl);
    await expect(
      customer.getByRole("heading", { name: "เลือกเมนูที่ชอบ", exact: true }),
    ).toBeVisible();
    await expect(customer.locator(".product-tile").first()).toBeVisible();
    await expect(customer.locator(".sidebar")).toHaveCount(0);
    await expect(
      customer.getByRole("link", { name: "รายงาน", exact: true }),
    ).toHaveCount(0);
    const initialAxe = await new AxeBuilder({ page: customer })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    assert.deepEqual(
      initialAxe.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
      [],
      "Customer menu accessibility violations",
    );
    assert(
      await customer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Customer menu overflows mobile width",
    );
    await customer
      .locator(".product-tile")
      .filter({ hasText: "อเมริกาโน่" })
      .click();
    await customer.getByRole("radio", { name: /ไม่หวาน/ }).check();
    await customer
      .getByRole("button", { name: "เพิ่มลงตะกร้า", exact: true })
      .click();
    await customer.evaluate(() => window.scrollTo(0, 0));
    await customer.screenshot({
      path: join(output, "customer-menu-mobile.png"),
      fullPage: true,
    });
    let dropped = false;
    await customer.route("**/api/guest/tables/*/orders", async (route) => {
      if (!dropped && route.request().method() === "POST") {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
      } else await route.continue();
    });
    await customer
      .getByRole("button", { name: "ส่งออเดอร์", exact: true })
      .click();
    await customer
      .getByRole("dialog")
      .last()
      .getByRole("button", { name: "ยืนยันสั่งอาหาร", exact: true })
      .click();
    await expect(customer.getByText(/ยังยืนยันผลการส่งไม่ได้/)).toBeVisible();
    await customer.unroute("**/api/guest/tables/*/orders");
    await customer
      .getByRole("button", { name: "ตรวจสอบคำสั่งซื้อ", exact: true })
      .click();
    await expect(customer).toHaveURL(/\/track\/[a-f0-9]{64}$/);
    await expect(
      customer.getByRole("heading", {
        name: "รอร้านยืนยัน",
        exact: true,
      }),
    ).toBeVisible();
    const trackingToken = new URL(customer.url()).pathname.split("/").pop();
    const own = await (
      await context.request.get(
        new URL("/api/guest/orders/" + trackingToken, menuUrl).href,
      )
    ).json();
    assert.equal(own.order.total_satang, 6500);
    assert.equal(own.order.table_no, "1");
    assert.equal(own.order.payment_status, null);
    assert(
      !/cost_satang|ingredients|steps|created_by|tracking_hash/.test(
        JSON.stringify(own),
      ),
    );
    assert.deepEqual(unexpected, [], "Customer screen requested private APIs");
    checks.push(
      "Anonymous mobile table ordering and lost-response recovery without duplicate submit",
    );
    await expect(page.locator(".nav-count")).toHaveText("1");
    assert.equal(
      (await (await page.context().request.get(base + "/api/kds")).json())
        .orders.length,
      0,
      "Unconfirmed guest order entered KDS",
    );
    await page.goto(base + "/orders");
    const qrRows = page.getByRole("row").filter({ hasText: "สั่งผ่าน QR" });
    await expect(qrRows).toHaveCount(1);
    await qrRows
      .getByRole("button", { name: "เปิดออเดอร์", exact: true })
      .click();
    await page
      .getByRole("button", { name: "ยืนยันและส่งเข้าบาร์", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .last()
      .getByRole("button", { name: "ยืนยันและส่งเข้าบาร์", exact: true })
      .click();
    await expect(
      customer.getByRole("heading", { name: "รอทำ", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.goto(base + "/kds");
    await page.getByRole("button", { name: "เริ่มทำ", exact: true }).click();
    await expect(
      customer.getByRole("heading", { name: "กำลังทำ", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await customer.screenshot({
      path: join(output, "customer-status-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "เสร็จแล้ว", exact: true }).click();
    await expect(
      customer.getByRole("heading", { name: "รอเสิร์ฟ", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.goto(base + "/orders");
    await page
      .getByRole("row")
      .filter({ hasText: "สั่งผ่าน QR" })
      .getByRole("button", { name: "เปิดออเดอร์", exact: true })
      .click();
    await page
      .getByRole("button", { name: "ส่งมอบให้ลูกค้าแล้ว", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .last()
      .getByRole("button", { name: "ยืนยันส่งมอบ", exact: true })
      .click();
    await expect(
      customer.getByRole("heading", { name: "เสิร์ฟแล้ว", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      customer.getByText("ยังไม่รับชำระ · ทานเสร็จแล้วชำระที่เคาน์เตอร์", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".nav-count")).toHaveText("1");
    await customer.screenshot({
      path: join(output, "customer-served-unpaid-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "รับชำระ", exact: true }).click();
    await page.getByRole("checkbox", { name: /ตรวจสอบว่าได้รับเงิน/ }).check();
    await page
      .getByRole("button", { name: "ยืนยันรับชำระ", exact: true })
      .click();
    await expect(
      customer.getByText("รับชำระแล้ว", { exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      customer.getByRole("heading", { name: "เสิร์ฟแล้ว", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".nav-count")).toHaveCount(0);
    checks.push(
      "Guest progress auto-updates through staff acceptance → unpaid KDS → served → payment after dining",
    );
    await page.getByRole("link", { name: "ใบเสร็จ", exact: true }).click();
    await expect(page.locator(".receipt")).toContainText(
      "ลูกค้าสั่งผ่าน QR ประจำโต๊ะ",
    );
    const statusAxe = await new AxeBuilder({ page: customer })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    assert.deepEqual(
      statusAxe.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
      [],
      "Customer tracking accessibility violations",
    );
    await customer
      .getByRole("link", { name: "กลับไปดูเมนู / สั่งเพิ่ม", exact: true })
      .click();
    await expect(customer.locator(".customer-history a")).toHaveCount(1);
    await customer.reload();
    await expect(customer.locator(".customer-history a")).toHaveCount(1);
    const stranger = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      const other = await stranger.newPage();
      await other.goto(menuUrl);
      await expect(other.locator(".product-tile").first()).toBeVisible();
      await expect(other.locator(".customer-history")).toHaveCount(0);
      const qr = new URL(menuUrl).pathname.split("/").pop();
      const denied = await stranger.request.get(
        new URL("/api/guest/orders/" + qr, menuUrl).href,
      );
      assert.equal(denied.status(), 404);
      const privateResponse = await stranger.request.get(
        new URL("/api/orders", menuUrl).href,
      );
      assert.equal(privateResponse.status(), 401);
    } finally {
      await stranger.close();
    }
    assert.deepEqual(errors, [], "Customer runtime errors");
    checks.push(
      "Customer QR isolation, same-device history, mobile layout and automated accessibility",
    );
  } catch (error) {
    await customer
      .screenshot({
        path: join(output, "customer-failure.png"),
        fullPage: true,
      })
      .catch(() => {});
    console.error(
      JSON.stringify({
        customer_origin: new URL(customer.url()).origin,
        customer_body: (
          await customer
            .locator("body")
            .innerText()
            .catch(() => "")
        ).slice(0, 1500),
        runtime_errors: errors,
      }),
    );
    throw error;
  } finally {
    await context.close();
  }
}
