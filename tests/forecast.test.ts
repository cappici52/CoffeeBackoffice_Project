import { createHash, randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { seedOwner } from "../src/seed.js";
import { history } from "../src/shop/forecasts.js";
import { dataset } from "../src/shop/forecast-data.js";
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
    .send({ date_from: day(1), date_to: day(1), data_mode: "mixed" });

// Forecast-controller fixtures satisfy the active service protocol by default.
function forecastResponse(body: string, init?: ResponseInit) {
  const parsed = JSON.parse(body);
  const normalized = Array.isArray(parsed)
    ? parsed.map((row) => ({
        ...row,
        diagnostics: {
          origin: day(-1),
          history_days: 28,
          reason: "controller-fixture",
          selection: {},
          pipeline: "coffee-demand-v5",
          ...row.diagnostics,
        },
      }))
    : parsed;
  return new Response(JSON.stringify(normalized), init);
}

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

async function delivered(productId: string, date: string, qty: number) {
  const id = randomUUID();
  await fixture.db.query(
    "INSERT INTO orders(id,request_key,request_hash,type,status,total_satang,created_by,completed_at) VALUES($1,$2,$3,'dine-in','completed',$4,$5,$6)",
    [id, randomUUID(), "test", qty * 7500, owner, date + "T23:55:00+07:00"],
  );
  await fixture.db.query(
    "INSERT INTO order_items(id,order_id,product_id,product_name,qty,unit_price_satang,unit_cost_satang,station,target_prep_seconds,status) VALUES($1,$2,$3,'Coffee',$4,7500,1000,'bar',180,'completed')",
    [randomUUID(), id, productId, qty],
  );
  return id;
}

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
  const order = await delivered(product, day(-3), 2);
  // Money arrives on another day: demand must stay on the delivery day.
  await fixture.db.query(
    "INSERT INTO payments(order_id,method,amount_satang,status,confirmed_by,paid_at) VALUES($1,'cash',15000,'paid',$2,$3)",
    [order, owner, day(-2) + "T00:05:00+07:00"],
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
    forecastResponse(
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
    .mockResolvedValue(forecastResponse(JSON.stringify(rows), { status: 200 }));
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
    forecastResponse(JSON.stringify([{ ...rows[0], lower: 0 }, rows[1]]), {
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
    .mockResolvedValue(
      forecastResponse(JSON.stringify([row]), { status: 200 }),
    );
  const submit = (product_id: string) =>
    request(app)
      .post("/api/forecasts/generate")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({
        date_from: day(1),
        date_to: day(1),
        product_id,
        data_mode: "mixed",
      });
  await submit(product).expect(200);
  expect(
    JSON.parse(fetch.mock.calls[0]![1]!.body as string).product_ids,
  ).toEqual([product]);
  fetch.mockResolvedValue(
    forecastResponse(
      JSON.stringify([row, { ...row, product_id: newProduct }]),
      {
        status: 200,
      },
    ),
  );
  await submit(product).expect(502);
  await submit(randomUUID()).expect(409, { error: "NO_FORECAST_PRODUCTS" });
});

test("accuracy evaluates immutable actual-only delivery forecasts, excludes demo inputs and backcasts", async () => {
  await fixture.db.query(
    "INSERT INTO day_closings(date,closed_by,summary) VALUES($1,$2,'{}')",
    [day(-4), owner],
  );
  for (const [id, source, issued] of [
    [product, "actual", day(-5)],
    [newProduct, "actual", date],
    [product, "demo", day(-5)],
  ] as const) {
    if (source === "actual") await delivered(id, day(-4), 4);
    const runId = randomUUID();
    await fixture.db.query(
      "INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history) VALUES($1,$2,$3,$3,$4,'fulfilled_v1',$5,'[]')",
      [
        runId,
        issued + "T12:00:00+07:00",
        day(-4),
        source === "actual" ? "actual" : "mixed",
        "a".repeat(64),
      ],
    );
    await fixture.db.query(
      "INSERT INTO forecast_run_points(run_id,forecast_date,product_id,predicted_qty,model_version,history_source,lead_days) VALUES($1,$2,$3,3,'weekly-naive-v1',$4,1)",
      [runId, day(-4), id, source],
    );
  }
  const response = await request(app)
    .get(`/api/forecasts?date_from=${day(-4)}&date_to=${day(-1)}`)
    .set("Cookie", cookie)
    .expect(200);
  expect(response.body.accuracy).toMatchObject({
    samples: 1,
    mae: 1,
    mape: 25,
    rmse: 1,
    wape: 25,
    bias: -1,
  });
  expect(
    response.body.evaluation.by_source.find(
      (g: { source: string }) => g.source === "demo",
    ).samples,
  ).toBe(1);
});

test("new generations append immutable runs, keep snapshots and allow selecting an earlier run", async () => {
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
    .mockResolvedValue(
      forecastResponse(JSON.stringify([row]), { status: 200 }),
    );
  const submit = () =>
    request(app)
      .post("/api/forecasts/generate")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({
        date_from: day(1),
        date_to: day(1),
        product_id: product,
        data_mode: "mixed",
      });
  const first = await submit().expect(200);
  fetch.mockResolvedValue(
    forecastResponse(JSON.stringify([{ ...row, predicted_qty: 15 }]), {
      status: 200,
    }),
  );
  const second = await submit().expect(200);
  expect(second.body.run_id).not.toBe(first.body.run_id);
  const old = await request(app)
    .get(
      `/api/forecasts?date_from=${day(1)}&date_to=${day(1)}&run_id=${first.body.run_id}`,
    )
    .set("Cookie", cookie)
    .expect(200);
  expect(Number(old.body.forecasts[0].predicted_qty)).toBe(8);
  await request(app)
    .get(`/api/forecasts/runs/${first.body.run_id}`)
    .expect(401);
  const exported = await request(app)
    .get(`/api/forecasts/runs/${first.body.run_id}`)
    .set("Cookie", cookie)
    .expect(200);
  expect(exported.body.run.id).toBe(first.body.run_id);
  expect(
    createHash("sha256")
      .update(exported.body.input_history_serialized, "utf8")
      .digest("hex"),
  ).toBe(exported.body.run.history_sha256);
  expect(Number(exported.body.points[0].predicted_qty)).toBe(8);
  const snapshot = (
    await fixture.db.query(
      "SELECT input_history,history_sha256 FROM forecast_runs WHERE id=$1",
      [first.body.run_id],
    )
  ).rows[0]!;
  expect(Array.isArray(snapshot.input_history)).toBe(true);
  expect(snapshot.history_sha256).toMatch(/^[a-f0-9]{64}$/);
  await expect(
    fixture.db.query(
      "UPDATE forecast_run_points SET predicted_qty=99 WHERE run_id=$1",
      [first.body.run_id],
    ),
  ).rejects.toThrow();
  await expect(
    fixture.db.query("DELETE FROM forecast_runs WHERE id=$1", [
      first.body.run_id,
    ]),
  ).rejects.toThrow();
});

test("fulfilled unpaid goods count but cancelled orders are excluded from demand", async () => {
  const order = await delivered(newProduct, day(-5), 3);
  const before = (await history(fixture.db, "actual")).find(
    (h) => h.product_id === newProduct && h.date === day(-5),
  );
  expect(Number(before?.qty)).toBe(3);
  await fixture.db.query(
    "INSERT INTO payments(order_id,method,amount_satang,status,confirmed_by,paid_at,refunded_at) VALUES($1,'cash',22500,'refunded',$2,$3,now())",
    [order, owner, day(-5) + "T23:56:00+07:00"],
  );
  await fixture.db.query("UPDATE orders SET status='cancelled' WHERE id=$1", [
    order,
  ]);
  expect(
    (await history(fixture.db, "actual")).find(
      (h) => h.product_id === newProduct && h.date === day(-5),
    ),
  ).toBeUndefined();
});

test("reissuing the same lead does not replace or multiply genuine accuracy samples", async () => {
  const run = randomUUID();
  await fixture.db.query(
    "INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history) VALUES($1,$2,$3,$3,'actual','fulfilled_v1',$4,'[]')",
    [run, day(-5) + "T23:00:00+07:00", day(-4), "b".repeat(64)],
  );
  await fixture.db.query(
    "INSERT INTO forecast_run_points(run_id,forecast_date,product_id,predicted_qty,model_version,history_source,lead_days) VALUES($1,$2,$3,99,'weekly-naive-v1','actual',1)",
    [run, day(-4), product],
  );
  const result = await request(app)
    .get(`/api/forecasts?date_from=${day(-4)}&date_to=${day(-4)}&lead_days=1`)
    .set("Cookie", cookie)
    .expect(200);
  expect(result.body.accuracy).toMatchObject({ samples: 1, mae: 1, wape: 25 });
});

test("production history mode cannot silently accept demo-trained results", async () => {
  const service = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    forecastResponse(
      JSON.stringify([
        {
          date: day(1),
          product_id: product,
          predicted_qty: 8,
          lower: null,
          upper: null,
          model_version: "weekly-naive-v1",
          history_source: "demo",
        },
      ]),
      { status: 200 },
    ),
  );
  await request(app)
    .post("/api/forecasts/generate")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ date_from: day(1), date_to: day(1), product_id: product })
    .expect(502);
  service.mockResolvedValue(
    forecastResponse(
      JSON.stringify([
        {
          date: day(1),
          product_id: product,
          predicted_qty: 8,
          lower: null,
          upper: null,
          model_version: "weekly-naive-v1",
          history_source: "actual",
          diagnostics: { pipeline: "coffee-selection-v3" },
        },
      ]),
      { status: 200 },
    ),
  );
  await request(app)
    .post("/api/forecasts/generate")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ date_from: day(1), date_to: day(1), product_id: product })
    .expect(502);
});

test("forecasts derived from replay orders retain provenance and are scored separately from genuine sales", async () => {
  const simulation = randomUUID(),
    menu = randomUUID();
  await fixture.db.query(
    "INSERT INTO shop_simulation_runs(id,date_from,date_to,seed,status,created_by) VALUES($1,$2,$3,42,'complete',$4)",
    [simulation, day(-3), day(-1), owner],
  );
  await fixture.db.query(
    "INSERT INTO products(id,category_id,name,price_satang,station) SELECT $1,category_id,'Replay menu',7500,'bar' FROM products WHERE id=$2",
    [menu, product],
  );
  const order = await delivered(menu, day(-1), 2);
  await fixture.db.query(
    "INSERT INTO day_closings(date,closed_by,summary) VALUES($1,$2,'{}')",
    [day(-1), owner],
  );
  await fixture.db.query("UPDATE orders SET simulation_run_id=$1 WHERE id=$2", [
    simulation,
    order,
  ]);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    forecastResponse(
      JSON.stringify([
        {
          date: day(1),
          product_id: menu,
          predicted_qty: 3,
          lower: null,
          upper: null,
          model_version: "weekly-naive-v1",
          history_source: "actual",
        },
      ]),
      { status: 200 },
    ),
  );
  const generated = await request(app)
    .post("/api/forecasts/generate")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({
      date_from: day(1),
      date_to: day(1),
      product_id: menu,
      cohort: "simulation",
    })
    .expect(200);
  const exported = await request(app)
    .get("/api/forecasts/runs/" + generated.body.run_id)
    .set("Cookie", cookie)
    .expect(200);
  expect(exported.body.run.contains_simulated_sales).toBe(true);
  const previous = randomUUID();
  await fixture.db.query(
    "INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history,contains_simulated_sales) VALUES($1,$2,$3,$3,'actual','fulfilled_v1',$4,'[]',true)",
    [previous, day(-2) + "T08:00:00+07:00", day(-1), "a".repeat(64)],
  );
  await fixture.db.query(
    "INSERT INTO forecast_run_points(run_id,forecast_date,product_id,predicted_qty,model_version,history_source,lead_days) VALUES($1,$2,$3,3,'weekly-naive-v1','actual',1)",
    [previous, day(-1), menu],
  );
  const data = await request(app)
    .get(
      `/api/forecasts?date_from=${day(-1)}&date_to=${day(-1)}&product_id=${menu}`,
    )
    .set("Cookie", cookie)
    .expect(200);
  expect(data.body.contains_simulated_sales).toBe(true);
  expect(data.body.accuracy.samples).toBe(0);
  expect(
    data.body.evaluation.by_source.find(
      (s: { source: string }) => s.source === "simulation",
    ),
  ).toMatchObject({ samples: 1, mae: 1 });
});

test("latest display reads one immutable round and ignores stale or edited cache quantities", async () => {
  const menu = randomUUID(),
    older = randomUUID(),
    newer = randomUUID();
  await fixture.db.query(
    "INSERT INTO products(id,category_id,name,price_satang,station) SELECT $1,category_id,'Coherent round',7500,'bar' FROM products WHERE id=$2",
    [menu, product],
  );
  const ingredient = randomUUID();
  await fixture.db.query(
    "INSERT INTO ingredients(id,name,unit,cost_satang) VALUES($1,'Coherent ingredient','g',100)",
    [ingredient],
  );
  await fixture.db.query("INSERT INTO recipes(product_id) VALUES($1)", [menu]);
  await fixture.db.query(
    "INSERT INTO recipe_ingredients(product_id,ingredient_id,qty) VALUES($1,$2,2)",
    [menu, ingredient],
  );
  for (const [id, hour, qty] of [
    [older, "08", 11],
    [newer, "09", 22],
  ] as const) {
    await fixture.db.query(
      "INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history) VALUES($1,$2,$3,$3,'actual','fulfilled_v1',$4,'[]')",
      [id, date + "T" + hour + ":00:00+07:00", day(1), "b".repeat(64)],
    );
    await fixture.db.query(
      "INSERT INTO forecast_run_points(run_id,forecast_date,product_id,predicted_qty,model_version,history_source,lead_days) VALUES($1,$2,$3,$4,'mean-7-v1','actual',1)",
      [id, day(1), menu, qty],
    );
  }
  await fixture.db.query(
    "INSERT INTO forecasts(id,forecast_date,product_id,predicted_qty,lower_qty,upper_qty,model_version,history_source) VALUES($1,$2,$3,999,null,null,'mock-old','demo')",
    [randomUUID(), day(1), menu],
  );
  const response = await request(app)
    .get(
      `/api/forecasts?date_from=${day(1)}&date_to=${day(1)}&product_id=${menu}`,
    )
    .set("Cookie", cookie)
    .expect(200);
  expect(response.body.selected_run_id).toBe(newer);
  expect(response.body.displayed_run.id).toBe(newer);
  expect(response.body.forecasts).toHaveLength(1);
  expect(Number(response.body.forecasts[0].predicted_qty)).toBe(22);
  expect(response.body.contains_demo_history).toBe(false);
  expect(Number(response.body.recommendations[0].required_qty)).toBe(44);
  const old = await request(app)
    .get(
      `/api/forecasts?date_from=${day(1)}&date_to=${day(1)}&product_id=${menu}&run_id=${older}`,
    )
    .set("Cookie", cookie)
    .expect(200);
  expect(Number(old.body.forecasts[0].predicted_qty)).toBe(11);
});

test("browsing reaches beyond training history and unclosed observations stay out of training", async () => {
  const menu = randomUUID();
  await fixture.db.query(
    "INSERT INTO products(id,category_id,name,price_satang,station) SELECT $1,category_id,'History export',7500,'bar' FROM products WHERE id=$2",
    [menu, product],
  );
  await delivered(menu, day(-200), 12);
  await delivered(menu, day(-6), 5);
  expect(
    (await history(fixture.db, "actual")).some((h) => h.date === day(-200)),
  ).toBe(false);
  const response = await request(app)
    .get(
      `/api/forecasts?date_from=${day(-210)}&date_to=${day(-190)}&product_id=${menu}`,
    )
    .set("Cookie", cookie)
    .expect(200);
  expect(response.body.actual).toEqual([
    expect.objectContaining({
      date: day(-200),
      is_closed: false,
      product_name: "History export",
    }),
  ]);
  const closed = await history(fixture.db, "actual", { closedOnly: true });
  expect(closed.some((h) => h.product_id === menu)).toBe(false);
  expect(response.body.accuracy.samples).toBe(0);
  await fixture.db.query(
    "INSERT INTO day_closings(date,closed_by,summary) VALUES($1,$2,'{}')",
    [day(-200), owner],
  );
  expect(
    (
      await dataset(fixture.db, [menu], "genuine", false, {
        from: day(-210),
        to: day(-190),
      })
    ).rows,
  ).toEqual([expect.objectContaining({ date: day(-200), qty: 12 })]);
});

test("horizon comparisons use the frozen weekly baseline and match identical evaluation pairs", async () => {
  const menu = randomUUID(),
    run = randomUUID();
  await fixture.db.query(
    "INSERT INTO products(id,category_id,name,price_satang,station) SELECT $1,category_id,'Baseline check',7500,'bar' FROM products WHERE id=$2",
    [menu, product],
  );
  const input = Array.from({ length: 28 }, (_, i) => ({
    date: day(-68 + i),
    product_id: menu,
    qty: 10,
    unit_price: 75,
    source: "actual",
  }));
  await fixture.db.query(
    "INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history) VALUES($1,$2,$3,$4,'actual','fulfilled_v1',$5,$6)",
    [
      run,
      day(-40) + "T08:00:00+07:00",
      day(-39),
      day(-10),
      "f".repeat(64),
      JSON.stringify(input),
    ],
  );
  for (const [offset, lead] of [
    [-39, 1],
    [-33, 7],
    [-10, 30],
  ]) {
    await delivered(menu, day(offset!), 12);
    await fixture.db.query(
      "INSERT INTO day_closings(date,closed_by,summary) VALUES($1,$2,'{}')",
      [day(offset!), owner],
    );
    await fixture.db.query(
      "INSERT INTO forecast_run_points(run_id,forecast_date,product_id,predicted_qty,model_version,history_source,lead_days,diagnostics) VALUES($1,$2,$3,8,'mean-7-v1','actual',$4,$5)",
      [run, day(offset!), menu, lead, JSON.stringify({ origin: day(-41) })],
    );
  }
  const result = await request(app)
    .get(
      `/api/forecasts?date_from=${day(-39)}&date_to=${day(-10)}&product_id=${menu}`,
    )
    .set("Cookie", cookie)
    .expect(200);
  const groups = result.body.evaluation.by_horizon.filter(
    (r: { source: string }) => r.source === "actual",
  );
  expect(groups.map((r: { samples: number }) => r.samples)).toEqual([1, 2, 3]);
  for (const g of groups) {
    expect(g.mae).toBe(4);
    expect(g.baseline.mae).toBe(2);
    expect(g.paired_model.samples).toBe(g.baseline.samples);
  }
});

test("source-separated dataset honors audited quality exclusions without changing sales", async () => {
  const menu = randomUUID();
  await fixture.db.query(
    "INSERT INTO products(id,category_id,name,price_satang,station) SELECT $1,category_id,'Quality check',7500,'bar' FROM products WHERE id=$2",
    [menu, product],
  );
  await delivered(menu, day(-4), 5);
  const url = `/api/forecasts/data?cohort=genuine&product_id=${menu}`;
  await request(app).get(url).expect(401);
  const before = await request(app).get(url).set("Cookie", cookie).expect(200);
  expect(before.body.rows.some((r: { qty: number }) => r.qty === 5)).toBe(true);
  await request(app)
    .put("/api/forecasts/quality")
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send({
      date: day(-4),
      product_id: menu,
      kind: "stockout",
      note: "Known supply interruption",
    })
    .expect(200);
  const after = await request(app).get(url).set("Cookie", cookie).expect(200);
  expect(after.body.rows).toHaveLength(0);
  expect(after.body.excluded.flagged).toBe(1);
  expect(
    Number(
      (await history(fixture.db, "actual")).find((r) => r.product_id === menu)
        ?.qty,
    ),
  ).toBe(5);
  expect(
    (
      await fixture.db.query(
        "SELECT action FROM audit_logs WHERE entity_id=$1 AND action='forecast.quality'",
        [menu],
      )
    ).rows,
  ).toHaveLength(1);
});

test("v4 evaluation stays separate from legacy forecasts and measures realized interval coverage", async () => {
  const menu = randomUUID(),
    legacy = randomUUID(),
    current = randomUUID();
  await fixture.db.query(
    "INSERT INTO products(id,category_id,name,price_satang,station) SELECT $1,category_id,'Pipeline separation',7500,'bar' FROM products WHERE id=$2",
    [menu, product],
  );
  await delivered(menu, day(-8), 5);
  await fixture.db.query(
    "INSERT INTO day_closings(date,closed_by,summary) VALUES($1,$2,'{}')",
    [day(-8), owner],
  );
  const input = Array.from({ length: 28 }, (_, i) => ({
    date: day(-37 + i),
    product_id: menu,
    qty: 5,
    unit_price: 75,
    source: "actual",
  }));
  for (const [id, pipeline, qty] of [
    [legacy, "legacy", 100],
    [current, "coffee-demand-v4", 4],
  ] as const) {
    await fixture.db.query(
      "INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history,training_cohort,input_quality) VALUES($1,$2,$3,$3,'actual','fulfilled_v1',$4,$5,$6,$7)",
      [
        id,
        day(-9) + "T08:00:00+07:00",
        day(-8),
        "c".repeat(64),
        JSON.stringify(input),
        pipeline === "legacy" ? "legacy" : "genuine",
        JSON.stringify({ pipeline }),
      ],
    );
    await fixture.db.query(
      "INSERT INTO forecast_run_points(run_id,forecast_date,product_id,predicted_qty,model_version,history_source,lead_days,lower_qty,upper_qty,diagnostics) VALUES($1,$2,$3,$4,'mean-7-v1','actual',1,$5,$6,$7)",
      [
        id,
        day(-8),
        menu,
        qty,
        pipeline === "legacy" ? null : 3,
        pipeline === "legacy" ? null : 6,
        JSON.stringify({
          origin: day(-10),
          pipeline,
          interval_kind:
            pipeline === "legacy" ? "unavailable" : "empirical_absolute_80",
        }),
      ],
    );
  }
  const response = await request(app)
    .get(
      `/api/forecasts?date_from=${day(-8)}&date_to=${day(-8)}&run_id=${current}&product_id=${menu}`,
    )
    .set("Cookie", cookie)
    .expect(200);
  expect(response.body.evaluation.pipeline).toBe("coffee-demand-v4");
  expect(response.body.accuracy).toMatchObject({ samples: 1, mae: 1 });
  expect(
    response.body.evaluation.by_pipeline.find(
      (r: { pipeline: string; source: string }) =>
        r.pipeline === "legacy" && r.source === "actual",
    ),
  ).toMatchObject({ samples: 1, mae: 95 });
  expect(
    response.body.evaluation.by_horizon.find(
      (r: { source: string; horizon: number }) =>
        r.source === "actual" && r.horizon === 1,
    ).interval,
  ).toMatchObject({ samples: 1, coverage: 100 });
  const oldView = await request(app)
    .get(
      `/api/forecasts?date_from=${day(-8)}&date_to=${day(-8)}&run_id=${legacy}&product_id=${menu}`,
    )
    .set("Cookie", cookie)
    .expect(200);
  expect(oldView.body.evaluation.pipeline).toBe("legacy");
  expect(oldView.body.accuracy).toMatchObject({ samples: 1, mae: 95 });
  await request(app)
    .put("/api/forecasts/quality")
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send({
      date: day(-8),
      product_id: menu,
      kind: "incomplete",
      note: "Incomplete test input",
    })
    .expect(200);
  const excluded = await request(app)
    .get(
      `/api/forecasts?date_from=${day(-8)}&date_to=${day(-8)}&run_id=${current}`,
    )
    .set("Cookie", cookie)
    .expect(200);
  expect(excluded.body.accuracy.samples).toBe(0);
  expect(
    Number(
      (
        await fixture.db.query(
          "SELECT predicted_qty FROM forecast_run_points WHERE run_id=$1",
          [legacy],
        )
      ).rows[0]?.predicted_qty,
    ),
  ).toBe(100);
});

test("backtest cuts off future sales, ignores closures learned later and never creates issued forecasts", async () => {
  const menu = randomUUID();
  await fixture.db.query(
    "INSERT INTO products(id,category_id,name,price_satang,station,forecast_since) SELECT $1,category_id,'As-of test',7500,'bar',$3 FROM products WHERE id=$2",
    [menu, product, day(-10)],
  );
  await delivered(menu, day(-5), 10);
  await delivered(menu, day(-4), 999);
  for (const d of [-5, -4])
    await fixture.db.query(
      "INSERT INTO day_closings(date,closed_by,summary) VALUES($1,$2,'{}') ON CONFLICT DO NOTHING",
      [day(d), owner],
    );
  await fixture.db.query(
    "INSERT INTO forecast_day_quality(date,product_id,kind,note,updated_by) VALUES($1,$2,'closed','Learned after cutoff',$3)",
    [day(-4), menu, owner],
  );
  const before = (
    await fixture.db.query("SELECT count(*)::int AS n FROM forecast_runs")
  ).rows[0]!.n;
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_url, options) => {
      const body = JSON.parse(options!.body as string);
      expect(
        body.history.every((h: { date: string }) => h.date <= day(-5)),
      ).toBe(true);
      expect(body.history.some((h: { qty: number }) => h.qty === 999)).toBe(
        false,
      );
      expect(body.history.at(-1).qty).toBe(10);
      return forecastResponse(
        JSON.stringify([
          {
            date: day(-4),
            product_id: menu,
            predicted_qty: 10,
            lower: null,
            upper: null,
            model_version: "mean-7-v1",
            history_source: "actual",
            diagnostics: { origin: day(-5) },
          },
        ]),
        { status: 200 },
      );
    });
  const analysis = await request(app)
    .post("/api/forecasts/backtest")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({
      cutoff: day(-5),
      horizon: 1,
      history_days: 180,
      product_id: menu,
      cohort: "genuine",
    })
    .expect(200);
  expect(fetch).toHaveBeenCalledOnce();
  expect(analysis.body.forecasts[0].predicted_qty).toBe(10);
  expect(analysis.body.kind).toBe("backtest");
  expect(
    (await fixture.db.query("SELECT count(*)::int AS n FROM forecast_runs"))
      .rows[0]!.n,
  ).toBe(before);
  await request(app)
    .post("/api/forecasts/backtest")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ cutoff: day(0) })
    .expect(400);
  await request(app)
    .post("/api/forecasts/generate")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ horizon: 7, date_from: day(1), date_to: day(1) })
    .expect(400);
});

test("an explicitly closed future menu day records a scheduled zero without changing old forecasts", async () => {
  const menu = randomUUID();
  await fixture.db.query(
    "INSERT INTO products(id,category_id,name,price_satang,station) SELECT $1,category_id,'Scheduled closure',7500,'bar' FROM products WHERE id=$2",
    [menu, product],
  );
  await request(app)
    .put("/api/forecasts/quality")
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send({
      date: day(1),
      product_id: menu,
      kind: "closed",
      note: "Planned menu closure",
    })
    .expect(200);
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    forecastResponse(
      JSON.stringify([
        {
          date: day(1),
          product_id: menu,
          predicted_qty: 12,
          lower: null,
          upper: null,
          model_version: "mean-28-v1",
          history_source: "actual",
        },
      ]),
      { status: 200 },
    ),
  );
  const created = await request(app)
    .post("/api/forecasts/generate")
    .set("Cookie", cookie)
    .set("Origin", origin)
    .send({
      date_from: day(1),
      date_to: day(1),
      product_id: menu,
      cohort: "genuine",
    })
    .expect(200);
  expect(
    JSON.parse(fetch.mock.calls[0]![1]!.body as string).method_policy,
  ).toBe("auto");
  const run = await request(app)
    .get("/api/forecasts/runs/" + created.body.run_id)
    .set("Cookie", cookie)
    .expect(200);
  expect(Number(run.body.points[0].predicted_qty)).toBe(0);
  expect(run.body.points[0].model_version).toBe("scheduled-closure-v1");
  expect(run.body.run.input_quality.method_policy).toBe("auto");
});
