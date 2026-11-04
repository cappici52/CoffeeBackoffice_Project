import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { seedOwner } from "../src/seed.js";
import { businessDate } from "../src/shop/shared.js";
import { testDatabase } from "./database.js";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof createApp>;
let cookie: string;
let manager: string;
let kitchen: string;
let product: string;
let ingredient: string;
const origin = "http://localhost:3001";
const date = businessDate();
const future = new Date(Date.parse(date + "T00:00:00Z") + 86400000)
  .toISOString()
  .slice(0, 10);
const post = (url: string, body: object, session = cookie) =>
  request(app)
    .post(url)
    .set("Origin", origin)
    .set("Cookie", session)
    .send(body);
beforeAll(async () => {
  fixture = await testDatabase();
  await migrate(fixture.db);
  await seedOwner(fixture.db, "owner@example.com", "Coffee-password-123");
  app = createApp(
    fixture.db,
    readConfig({ DATABASE_URL: "postgresql://test:test@localhost/test" }),
  );
  const hash = (
    await fixture.db.query("SELECT password_hash FROM users LIMIT 1")
  ).rows[0]?.password_hash;
  for (const role of ["manager", "kitchen"])
    await fixture.db.query(
      "INSERT INTO users (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$2)",
      [randomUUID(), role, `${role}@example.com`, hash],
    );
  await fixture.db.query("INSERT INTO user_branches(user_id,branch_id) SELECT id,'00000000-0000-4000-8000-000000000016' FROM users WHERE role<>'owner' ON CONFLICT DO NOTHING");
  async function login(role: string) {
    const r = await post(
      "/api/auth/login",
      { email: role + "@example.com", password: "Coffee-password-123" },
      "",
    ).expect(200);
    return r.headers["set-cookie"]![0]!.split(";")[0]!;
  }
  cookie = await login("owner");
  manager = await login("manager");
  kitchen = await login("kitchen");
  const c = (await post("/api/categories", { name: "กาแฟ" })).body.category.id;
  ingredient = (
    await post("/api/ingredients", {
      name: "เมล็ด",
      unit: "g",
      reorder_point: 100,
      cost_satang: 100,
    })
  ).body.id;
  await post("/api/stock-movements", {
    ingredient_id: ingredient,
    type: "receipt",
    qty: 500,
    reason: "เริ่มต้น",
  });
  product = (
    await post("/api/products", {
      name: "กาแฟ",
      category_id: c,
      price_satang: 7500,
    })
  ).body.product.id;
  await request(app)
    .put("/api/recipes/" + product)
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({
      expected_version: 0,
      ingredients: [{ ingredient_id: ingredient, qty: 18 }],
      steps: [],
    });
  const o = (
    await post("/api/orders", {
      request_key: randomUUID(),
      type: "takeaway",
      payment_method: "cash",
      items: [{ product_id: product, qty: 1 }],
    }).expect(201)
  ).body.order;
  await post(
    "/api/kds/items/" + o.items[0].id + "/status",
    { status: "preparing" },
    kitchen,
  ).expect(204);
  await post(
    "/api/kds/items/" + o.items[0].id + "/status",
    { status: "ready" },
    kitchen,
  ).expect(204);
  await post("/api/orders/" + o.id + "/status", { status: "completed" }).expect(
    200,
  );
}, 30000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => fixture?.close());
test("sales and recipe profit use actual paid orders with Bangkok dates", async () => {
  const r = await request(app)
    .get(`/api/reports?date_from=${date}&date_to=${date}`)
    .set("Cookie", cookie)
    .expect(200);
  expect(Number(r.body.summary.revenue_satang)).toBe(7500);
  expect(r.body.summary.orders).toBe(1);
  expect(r.body.products[0].profit_satang).toBe(5700);
  expect(Number(r.body.products[0].avg_prep_seconds)).toBeGreaterThanOrEqual(0);
});
test("manager cannot receive profit fields and kitchen cannot access reports/forecast/audit", async () => {
  const r = await request(app)
    .get(`/api/reports?date_from=${date}&date_to=${date}`)
    .set("Cookie", manager)
    .expect(200);
  expect(JSON.stringify(r.body)).not.toMatch(/profit_satang|cost_satang/);
  for (const path of [
    `/reports?date_from=${date}&date_to=${date}`,
    `/forecasts?date_from=${date}&date_to=${future}`,
    "/audit-logs",
  ])
    await request(app)
      .get("/api" + path)
      .set("Cookie", kitchen)
      .expect(403);
});
test("forecast service failures produce actionable errors and no stored predictions", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  await post("/api/forecasts/generate", {
    date_from: future,
    date_to: future,
  }).expect(502, { error: "FORECAST_SERVICE_UNAVAILABLE" });
  expect(
    (await fixture.db.query("SELECT id FROM forecasts")).rows,
  ).toHaveLength(0);
});
test("forecast response is validated and replenishment uses recipe minus current stock", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify([
        {
          date: future,
          product_id: product,
          predicted_qty: 40,
          lower: 32,
          upper: 48,
          model_version: "mock-test",
          history_source: "actual",
          diagnostics: {
            origin: date,
            history_days: 28,
            reason: "report-fixture",
            selection: {},
            pipeline: "coffee-demand-v5",
          },
        },
      ]),
      { status: 200 },
    ),
  );
  await post("/api/forecasts/generate", {
    date_from: future,
    date_to: future,
  }).expect(200);
  const r = await request(app)
    .get(`/api/forecasts?date_from=${future}&date_to=${future}`)
    .set("Cookie", cookie)
    .expect(200);
  expect(r.body.forecasts).toHaveLength(1);
  expect(Number(r.body.recommendations[0].order_qty)).toBe(
    40 * 18 - (500 - 18),
  );
  expect(r.body.accuracy.mape).toBeNull();
});
test("incomplete or malformed model output is rejected atomically", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("[]", { status: 200 }),
  );
  await post("/api/forecasts/generate", {
    date_from: future,
    date_to: future,
  }).expect(502, { error: "FORECAST_INVALID_RESPONSE" });
  expect(
    (await fixture.db.query("SELECT id FROM forecasts")).rows,
  ).toHaveLength(1);
});
test("closing is immutable and prevents payments after close", async () => {
  await post(
    "/api/reports/close",
    { date, note: "ตรวจเงินครบแล้ว" },
    manager,
  ).expect(204);
  await post("/api/reports/close", { date }, manager).expect(409);
  await post("/api/orders", {
    request_key: randomUUID(),
    type: "takeaway",
    payment_method: "cash",
    items: [{ product_id: product, qty: 1 }],
  }).expect(409, { error: "DAY_ALREADY_CLOSED" });
  expect((await fixture.db.query("SELECT id FROM orders")).rows).toHaveLength(
    1,
  );
});
