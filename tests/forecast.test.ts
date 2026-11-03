import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { seedOwner } from "../src/seed.js";
import { history } from "../src/shop/forecasts.js";
import { businessDate } from "../src/shop/shared.js";
import { testDatabase } from "./database.js";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof createApp>;
let cookie: string;
let owner: string;
const product = randomUUID();
const newProduct = randomUUID();
const origin = "http://localhost:3001";
const date = businessDate();
const day = (offset: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + offset * 86400000)
    .toISOString()
    .slice(0, 10);
const generate = () =>
  request(app)
    .post("/api/forecasts/generate")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ date_from: day(1), date_to: day(1) });

beforeAll(async () => {
  fixture = await testDatabase();
  await migrate(fixture.db);
  await seedOwner(fixture.db, "owner@example.com", "Coffee-test-password1");
  app = createApp(
    fixture.db,
    readConfig({ DATABASE_URL: "postgresql://test:test@localhost/test" }),
  );
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: "owner@example.com", password: "Coffee-test-password1" })
    .expect(200);
  cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
  owner = (await fixture.db.query("SELECT id FROM users LIMIT 1")).rows[0]!.id;
  const category = randomUUID();
  await fixture.db.query(
    "INSERT INTO categories(id,name) VALUES($1,'coffee')",
    [category],
  );
  for (const id of [product, newProduct])
    await fixture.db.query(
      "INSERT INTO products(id,category_id,name,price_satang,station) VALUES($1,$2,$3,7500,'bar')",
      [id, category, id],
    );
  await fixture.db.query("UPDATE products SET forecast_since=$2 WHERE id=$1", [
    product,
    day(-4),
  ]);
}, 30000);
afterEach(() => vi.restoreAllMocks());
afterAll(async () => fixture?.close());

test("history supplies prices in baht, prefers actual observations, and excludes partial current days", async () => {
  for (const [date, qty, revenue, source] of [
    [day(-3), 10, 65000, "demo"],
    [day(-3), 2, 15000, "actual"],
    [day(0), 999, 999000, "demo"],
  ] as const)
    await fixture.db.query(
      "INSERT INTO sales_daily(date,product_id,qty,revenue_satang,source) VALUES($1,$2,$3,$4,$5)",
      [date, product, qty, revenue, source],
    );
  const rows = await history(fixture.db);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.date).toBe(day(-3));
  expect(Number(rows[0]!.qty)).toBe(2);
  expect(Number(rows[0]!.unit_price)).toBe(75);
  expect(rows[0]!.source).toBe("actual");
});

test("zero sales are inferred only on closed days for an existing menu; they override demo rows", async () => {
  await fixture.db.query(
    "INSERT INTO day_closings(date,closed_by,summary) VALUES($1,$2,'{}')",
    [day(-2), owner],
  );
  await fixture.db.query(
    "INSERT INTO sales_daily(date,product_id,qty,revenue_satang,source) VALUES($1,$2,20,150000,'demo')",
    [day(-2), product],
  );
  const rows = await history(fixture.db);
  const zero = rows.find((r) => r.date === day(-2));
  expect(zero!.product_id).toBe(product);
  expect(Number(zero!.qty)).toBe(0);
  expect(Number(zero!.unit_price)).toBe(75);
  expect(zero!.source).toBe("actual");
  expect(rows.some((r) => r.product_id === newProduct)).toBe(false);
  expect(rows.some((r) => r.date === day(-1))).toBe(false);
});

test("insufficient model history is actionable and does not store fabricated predictions", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({ detail: { code: "FORECAST_INSUFFICIENT_HISTORY" } }),
      { status: 422 },
    ),
  );
  await generate().expect(409, { error: "FORECAST_INSUFFICIENT_HISTORY" });
  expect(
    (await fixture.db.query("SELECT id FROM forecasts")).rows,
  ).toHaveLength(0);
});

test("real point forecasts persist without fake intervals and half-null bounds are rejected atomically", async () => {
  const rows = [product, newProduct].map((product_id) => ({
    date: day(1),
    product_id,
    predicted_qty: 12,
    lower: null,
    upper: null,
    model_version: "coffee-xgb-v1-test",
    history_source: "demo",
  }));
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 }));
  await generate().expect(200);
  const payload = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
  expect(
    payload.history.every(
      (r: Record<string, unknown>) =>
        "unit_price" in r && "source" in r && !("revenue" in r),
    ),
  ).toBe(true);
  let result = await request(app)
    .get(`/api/forecasts?date_from=${day(1)}&date_to=${day(1)}`)
    .set("Cookie", cookie)
    .expect(200);
  expect(result.body.model_mode).toBe("adaptive");
  expect(
    result.body.forecasts.every(
      (r: { history_source: string }) => r.history_source === "demo",
    ),
  ).toBe(true);
  expect(
    result.body.forecasts.every(
      (r: { lower_qty: unknown; upper_qty: unknown }) =>
        r.lower_qty === null && r.upper_qty === null,
    ),
  ).toBe(true);
  fetch.mockResolvedValue(
    new Response(JSON.stringify([{ ...rows[0], lower: 0 }, rows[1]]), {
      status: 200,
    }),
  );
  await generate().expect(502, { error: "FORECAST_INVALID_RESPONSE" });
  result = await request(app)
    .get(`/api/forecasts?date_from=${day(1)}&date_to=${day(1)}`)
    .set("Cookie", cookie);
  expect(
    result.body.forecasts.every(
      (r: { lower_qty: unknown }) => r.lower_qty === null,
    ),
  ).toBe(true);
  await fixture.db.query("DELETE FROM sales_daily WHERE source=$1", ["demo"]);
  result = await request(app)
    .get(`/api/forecasts?date_from=${day(1)}&date_to=${day(1)}`)
    .set("Cookie", cookie);
  expect(result.body.contains_demo_history).toBe(true);
});

test("a selected menu can be forecast independently of a new menu with no history", async () => {
  const row = {
    date: day(1),
    product_id: product,
    predicted_qty: 8,
    lower: null,
    upper: null,
    model_version: "weekly-naive-v1",
    history_source: "demo",
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify([row]), { status: 200 }));
  const submit = (product_id: string) =>
    request(app)
      .post("/api/forecasts/generate")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({ date_from: day(1), date_to: day(1), product_id });
  await submit(product).expect(200);
  expect(
    JSON.parse(fetch.mock.calls[0]![1]!.body as string).product_ids,
  ).toEqual([product]);
  fetch.mockResolvedValue(
    new Response(JSON.stringify([row, { ...row, product_id: newProduct }]), {
      status: 200,
    }),
  );
  await submit(product).expect(502);
  await submit(randomUUID()).expect(409, { error: "NO_FORECAST_PRODUCTS" });
});

test("accuracy uses real observations and predictions made before the target day, excluding demo and backcasts", async () => {
  for (const [id, offset, source] of [
    [product, -3, "actual"],
    [newProduct, -3, "actual"],
    [product, -1, "demo"],
  ] as const) {
    await fixture.db.query(
      "INSERT INTO sales_daily(date,product_id,qty,revenue_satang,source) VALUES($1,$2,4,30000,$3) ON CONFLICT(date,product_id,source) DO UPDATE SET qty=4,revenue_satang=30000",
      [day(offset), id, source],
    );
    await fixture.db.query(
      "INSERT INTO forecasts(id,forecast_date,product_id,predicted_qty,lower_qty,upper_qty,model_version,generated_at) VALUES($1,$2,$3,3,NULL,NULL,'coffee-xgb-v1-test',$4)",
      [
        randomUUID(),
        day(offset),
        id,
        id === newProduct
          ? date + "T12:00:00+07:00"
          : day(offset - 1) + "T12:00:00+07:00",
      ],
    );
  }
  const result = await request(app)
    .get(`/api/forecasts?date_from=${day(-4)}&date_to=${day(-1)}`)
    .set("Cookie", cookie)
    .expect(200);
  expect(result.body.accuracy).toEqual({ samples: 1, mape: 25, rmse: 1 });
});
