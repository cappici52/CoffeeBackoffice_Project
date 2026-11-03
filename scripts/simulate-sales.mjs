import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import request from "supertest";
import { stopSimulationService } from "./simulation-process.mjs";
import { createApp } from "../dist/app.js";
import { connectDatabase } from "../dist/db.js";
import { readConfig } from "../dist/config.js";
import { migrate } from "../dist/migrate.js";
import { seedOwner } from "../dist/seed.js";
import { metrics } from "../dist/shop/forecast-metrics.js";
import { history } from "../dist/shop/forecasts.js";
import {
  random,
  demand,
  dateOffset,
  sandboxUrl,
  weeklyPrediction,
} from "./simulation-plan.mjs";

if (process.env.NODE_ENV === "production")
  throw new Error("Simulation disabled in production");
const RealDate = Date;
const startedAt = new RealDate();
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(startedAt);
const firstDay = dateOffset(today, -211);
const name =
  "coffee_sim_" +
  startedAt.toISOString().replace(/\D/g, "").slice(0, 14) +
  "_" +
  randomBytes(4).toString("hex");
const target = sandboxUrl(process.env.DATABASE_URL, name);
const output = resolve(".local/simulation", name);
await mkdir(output, { recursive: true });
const source = connectDatabase(process.env.DATABASE_URL);
const adminUrl = new URL(process.env.DATABASE_URL);
adminUrl.pathname = "/postgres";
adminUrl.search = "";
const admin = connectDatabase(adminUrl.toString());
let db,
  model,
  app,
  server,
  clock = Date.parse(firstDay + "T08:00:00+07:00");
let apiCalls = 0;
const counters = {
  qr: 0,
  pos: 0,
  completed: 0,
  cancelled_pending: 0,
  cancelled_confirmed: 0,
  cancelled_started: 0,
  refunds: 0,
  stockouts: 0,
  duplicate_retries: 0,
  unpaid_close_blocked: 0,
  closed_day_blocked: 0,
  receipts: 0,
  waste: 0,
};
const origin = "http://localhost:3002";
const cookies = {};
const password = randomBytes(24).toString("base64url");
const next = random();
async function fingerprint() {
  const result = {};
  for (const table of [
    "orders",
    "payments",
    "ingredients",
    "stock_movements",
    "forecast_runs",
    "day_closings",
  ]) {
    result[table] = (
      await source.query(
        `SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS digest FROM ${table} t`,
      )
    ).rows[0];
  }
  return result;
}
const before = await fingerprint();
async function time(day, seconds = 8 * 3600) {
  clock = Date.parse(day + "T00:00:00+07:00") + seconds * 1000;
  await db.query("UPDATE simulation_clock SET instant=$1", [
    new RealDate(clock).toISOString(),
  ]);
}
async function api(role, method, path, body, status = 200) {
  apiCalls++;
  let req = request(server)
    [method](path)
    .set("Origin", origin)
    .timeout({ response: 20000, deadline: 30000 });
  if (role) req = req.set("Cookie", cookies[role]);
  if (body !== undefined) req = req.send(body);
  const response = await req;
  // Paths can contain private QR/tracking capabilities: never include them in errors.
  assert.equal(
    response.status,
    status,
    `${method.toUpperCase()} API expected ${status}, got ${response.status}: ${response.body.error ?? "unexpected response"}`,
  );
  return response.body;
}
async function login(role) {
  const response = await request(server)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: role + "@simulation.invalid", password });
  assert.equal(response.status, 200, "Simulation login failed");
  cookies[role] = response.headers["set-cookie"][0].split(";")[0];
}
try {
  // Identifier generated above, never a command-line/user-supplied name. Never reuse a DB.
  await admin.query(`CREATE DATABASE ${name}`);
  db = connectDatabase(target);
  await db.query(`CREATE TABLE simulation_clock(instant timestamptz NOT NULL);
    CREATE TABLE simulation_metadata(kind text NOT NULL CHECK(kind='synthetic-only'),seed integer NOT NULL);
    INSERT INTO simulation_metadata VALUES('synthetic-only',20261103);
    CREATE FUNCTION public.now() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT instant FROM public.simulation_clock';`);
  await db.query("INSERT INTO simulation_clock VALUES($1)", [
    new RealDate(clock).toISOString(),
  ]);
  // Only this dedicated process/database has a simulated clock. OS/live services unchanged.
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }
    static now() {
      return clock;
    }
  };
  await migrate(db);
  await seedOwner(db, "owner@simulation.invalid", password);
  for (const role of ["cashier", "kitchen"])
    await db.query(
      "INSERT INTO users(id,name,email,password_hash,role) SELECT $1,$2,$3,password_hash,$2 FROM users WHERE role='owner'",
      [randomUUID(), role, role + "@simulation.invalid"],
    );
  const portCheck = createServer();
  await new Promise((resolve, reject) => {
    portCheck.once("error", reject);
    portCheck.listen(18002, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => portCheck.close(resolve));
  const localPython = resolve(
    process.platform === "win32"
      ? ".venv/Scripts/python.exe"
      : ".venv/bin/python",
  );
  model = spawn(
    process.env.SIMULATION_PYTHON ??
      (existsSync(localPython) ? localPython : "python"),
    [
      "-m",
      "uvicorn",
      "app:app",
      "--app-dir",
      "forecast-service",
      "--host",
      "127.0.0.1",
      "--port",
      "18002",
    ],
    {
      env: { ...process.env, FORECAST_MODEL_DIR: resolve(output, "models") },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
  // Drain logs without exposing request payloads or credentials.
  model.stderr.resume();
  let spawnError;
  model.on("error", (error) => {
    spawnError = error;
  });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (spawnError || model.exitCode !== null)
      throw new Error("Isolated forecast service exited or could not start");
    try {
      if ((await fetch("http://127.0.0.1:18002/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, "Isolated forecast service unavailable");
  app = createApp(
    db,
    readConfig({
      DATABASE_URL: target,
      NODE_ENV: "test",
      APP_ORIGIN: origin,
      SESSION_HOURS: "168",
      FORECAST_SERVICE_URL: "http://127.0.0.1:18002",
    }),
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  for (const role of ["owner", "cashier", "kitchen"]) await login(role);
  await api("cashier", "post", "/api/tables", { name: "forbidden" }, 403);
  const category = (
    await api(
      "owner",
      "post",
      "/api/categories",
      { name: "SIMULATED MENU" },
      201,
    )
  ).category.id;
  const bean = (
    await api(
      "owner",
      "post",
      "/api/ingredients",
      {
        name: "วัตถุดิบเครื่องดื่มจำลอง",
        unit: "g",
        cost_satang: 100,
        reorder_point: 100,
      },
      201,
    )
  ).id;
  const pastry = (
    await api(
      "owner",
      "post",
      "/api/ingredients",
      {
        name: "เบเกอรีจำลอง",
        unit: "ชิ้น",
        cost_satang: 1500,
        reorder_point: 10,
      },
      201,
    )
  ).id;
  const products = [];
  for (const [i, label] of [
    "อเมริกาโน่",
    "ลาเต้",
    "คาปูชิโน่",
    "เอสเปรสโซ่",
    "ชาไทย",
    "มัทฉะ",
    "โกโก้",
    "ครัวซองต์",
  ].entries()) {
    const p = await api(
      "owner",
      "post",
      "/api/products",
      {
        category_id: category,
        name: label,
        price_satang: [6500, 7500, 7500, 6000, 6500, 8500, 7500, 6500][i],
        station: i === 7 ? "kitchen" : "bar",
        option_groups:
          i === 7
            ? []
            : [
                {
                  name: "ความหวาน",
                  is_required: true,
                  multi_select: false,
                  options: [
                    { name: "ปกติ", extra_price_satang: 0 },
                    { name: "เพิ่มช็อต", extra_price_satang: 1500 },
                  ],
                },
              ],
      },
      201,
    );
    products.push({ id: p.product.id, name: label });
    // Catalog/recipe fixtures only; transactional sales and stock use real API handlers.
    await db.query("INSERT INTO recipes(product_id) VALUES($1)", [
      p.product.id,
    ]);
    await db.query(
      "INSERT INTO recipe_ingredients(product_id,ingredient_id,qty) VALUES($1,$2,$3)",
      [p.product.id, i === 7 ? pastry : bean, i === 7 ? 1 : 18],
    );
    await db.query(
      "INSERT INTO recipe_steps(product_id,step_no,instruction,timer_seconds) VALUES($1,1,'ขั้นตอนจำลอง',60)",
      [p.product.id],
    );
  }
  await api("owner", "post", "/api/tables", { name: "SIM-01" }, 201);
  const table = (await api("owner", "get", "/api/tables")).tables[0];
  const menu = (await api(null, "get", "/api/guest/tables/" + table.qr_token))
    .products;
  let heldOutRun;
  let snapshot;
  for (let day = 0; day < 211; day++) {
    const date = dateOffset(firstDay, day);
    await time(date);
    if (day && day % 6 === 0)
      for (const role of ["owner", "cashier", "kitchen"]) await login(role);
    if (day === 180) {
      heldOutRun = await api("owner", "post", "/api/forecasts/generate", {
        date_from: dateOffset(date, 1),
        date_to: dateOffset(date, 30),
        data_mode: "actual",
      });
      snapshot = await api(
        "owner",
        "get",
        "/api/forecasts/runs/" + heldOutRun.run_id,
      );
      assert(
        snapshot.run.input_history.every((row) => row.date < date),
        "Future/issue-day leakage",
      );
      assert.equal(
        createHash("sha256")
          .update(snapshot.input_history_serialized)
          .digest("hex"),
        snapshot.run.history_sha256,
      );
      await writeFile(
        resolve(output, "frozen-holdout-forecast.json"),
        JSON.stringify({ synthetic: true, ...snapshot }, null, 2),
      );
      console.log(
        "Frozen 30-day forecast before held-out sales; input checksum verified",
      );
    }
    for (const [id, qty] of [
      [bean, 2000],
      [pastry, 45],
    ]) {
      await api(
        "owner",
        "post",
        "/api/stock-movements",
        {
          ingredient_id: id,
          type: "receipt",
          qty,
          reason: "SIMULATED daily receipt",
        },
        204,
      );
      counters.receipts++;
    }
    const quantities = demand(date, day, next);
    // Occasional deliberate shortage exercises rejection and rollback, not negative stock.
    if (day % 29 === 10) {
      const balance = Number(
        (
          await db.query("SELECT current_stock FROM ingredients WHERE id=$1", [
            bean,
          ])
        ).rows[0].current_stock,
      );
      if (balance) {
        await api(
          "owner",
          "post",
          "/api/stock-movements",
          {
            ingredient_id: bean,
            type: "waste",
            qty: balance,
            reason: "SIMULATED shortage",
          },
          204,
        );
        counters.waste++;
      }
    }
    let orderIndex = 0;
    const queue = [];
    for (const [i, quantity] of quantities.entries())
      for (let left = quantity; left > 0;) {
        const qty = Math.min(left, next() < 0.25 ? 2 : 1);
        left -= qty;
        queue.push({ i, qty });
      }
    // Fisher-Yates makes product mix/interarrival order independent of menu sorting.
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    for (const { i, qty } of queue) {
      const seconds = 9 * 3600 + orderIndex++ * 240;
      await time(date, seconds);
      const product = menu.find((p) => p.id === products[i].id);
      const options = product.option_groups.map(
        (g) => g.options[Math.floor(next() * g.options.length)],
      );
      const item = {
        product_id: product.id,
        qty,
        option_ids: options.map((o) => o.id),
      };
      const qr = next() < 0.6;
      const key = randomUUID(),
        tracking = randomBytes(32).toString("hex");
      let order;
      const body = qr
        ? {
            request_key: key,
            tracking_token: tracking,
            expected_total_satang:
              (product.price_satang +
                options.reduce((s, o) => s + o.extra_price_satang, 0)) *
              qty,
            items: [item],
          }
        : {
            request_key: key,
            type: "dine-in",
            table_no: "SIM-01",
            items: [item],
          };
      const path = qr
        ? "/api/guest/tables/" + table.qr_token + "/orders"
        : "/api/orders";
      order = (await api(qr ? null : "cashier", "post", path, body, 201)).order;
      if (qr) {
        counters.qr++;
        order.id = (
          await db.query("SELECT id FROM orders WHERE request_key=$1", [key])
        ).rows[0].id;
      } else counters.pos++;
      if (orderIndex === 1) {
        await api(qr ? null : "cashier", "post", path, body, 201);
        counters.duplicate_retries++;
        assert.equal(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM orders WHERE request_key=$1",
              [key],
            )
          ).rows[0].n,
          1,
        );
      }
      const scenario = next();
      if (scenario < 0.025) {
        await api("cashier", "post", `/api/orders/${order.id}/status`, {
          status: "cancelled",
          reason: "SIMULATED customer cancellation",
        });
        counters.cancelled_pending++;
        continue;
      }
      const ingredientId = i === 7 ? pastry : bean;
      const stockBefore = Number(
        (
          await db.query("SELECT current_stock FROM ingredients WHERE id=$1", [
            ingredientId,
          ])
        ).rows[0].current_stock,
      );
      const required = (i === 7 ? 1 : 18) * qty;
      if (stockBefore < required) {
        await api(
          "cashier",
          "post",
          `/api/orders/${order.id}/confirm`,
          {},
          409,
        );
        counters.stockouts++;
        assert.equal(
          Number(
            (
              await db.query(
                "SELECT current_stock FROM ingredients WHERE id=$1",
                [ingredientId],
              )
            ).rows[0].current_stock,
          ),
          stockBefore,
        );
        await api(
          "owner",
          "post",
          "/api/stock-movements",
          {
            ingredient_id: ingredientId,
            type: "receipt",
            qty: 2000,
            reason: "SIMULATED emergency receipt",
          },
          204,
        );
        counters.receipts++;
      }
      await api("cashier", "post", `/api/orders/${order.id}/confirm`, {});
      await api("cashier", "post", `/api/orders/${order.id}/confirm`, {});
      if (scenario < 0.05) {
        await api("cashier", "post", `/api/orders/${order.id}/status`, {
          status: "cancelled",
          reason: "SIMULATED before preparation",
        });
        counters.cancelled_confirmed++;
        continue;
      }
      const detail = (await api("cashier", "get", `/api/orders/${order.id}`))
        .order;
      await time(date, seconds + 30);
      for (const line of detail.items)
        await api(
          "kitchen",
          "post",
          `/api/kds/items/${line.id}/status`,
          { status: "preparing" },
          204,
        );
      if (scenario < 0.07) {
        await api("cashier", "post", `/api/orders/${order.id}/pay`, {
          method: "cash",
        });
        await api(
          "cashier",
          "post",
          `/api/orders/${order.id}/status`,
          {
            status: "cancelled",
            reason: "SIMULATED refund",
            confirm_refund: true,
          },
          403,
        );
        await api("owner", "post", `/api/orders/${order.id}/status`, {
          status: "cancelled",
          reason: "SIMULATED refund",
          confirm_refund: true,
        });
        counters.cancelled_started++;
        counters.refunds++;
        continue;
      }
      await time(date, seconds + 120);
      for (const line of detail.items)
        await api(
          "kitchen",
          "post",
          `/api/kds/items/${line.id}/status`,
          { status: "ready" },
          204,
        );
      await api("cashier", "post", `/api/orders/${order.id}/status`, {
        status: "completed",
      });
      if (qr) {
        const tracked = (
          await api(null, "get", "/api/guest/orders/" + tracking)
        ).order;
        assert.equal(tracked.status, "completed");
        assert.equal(tracked.payment_status, null);
      }
      if (day === 0 && counters.unpaid_close_blocked === 0) {
        await api("owner", "post", "/api/reports/close", { date }, 409);
        counters.unpaid_close_blocked++;
      }
      await time(date, seconds + 180);
      const method = next() < 0.45 ? "cash" : "promptpay";
      await api("cashier", "post", `/api/orders/${order.id}/pay`, { method });
      if (orderIndex === 1)
        await api("cashier", "post", `/api/orders/${order.id}/pay`, { method });
      counters.completed++;
    }
    await time(date, 23 * 3600);
    const report = await api(
      "owner",
      "get",
      `/api/reports?date_from=${date}&date_to=${date}`,
    );
    assert.equal(
      Number(report.summary.revenue_satang),
      Number(report.summary.cash_satang) +
        Number(report.summary.promptpay_satang),
    );
    await api(
      "owner",
      "post",
      "/api/reports/close",
      { date, note: "SYNTHETIC SALES ONLY" },
      204,
    );
    await api("owner", "post", "/api/reports/close", { date }, 409);
    counters.closed_day_blocked++;
    if (day % 15 === 14)
      console.log(
        `Simulated ${day + 1}/211 days; ${counters.completed} delivered orders; ${apiCalls} API checks`,
      );
  }
  await time(today);
  for (const role of ["owner", "cashier", "kitchen"]) await login(role);
  const all = await history(db, "actual");
  assert.equal(all.length, 8 * 120, "Complete latest history coverage");
  const evaluation = await api(
    "owner",
    "get",
    `/api/forecasts?date_from=${dateOffset(firstDay, 181)}&date_to=${dateOffset(firstDay, 210)}&run_id=${heldOutRun.run_id}&data_mode=actual`,
  );
  const lookup = new Map(
    all.map((row) => [row.date + ":" + row.product_id, Number(row.qty)]),
  );
  const pairs = snapshot.points.map((point) => ({
    actual: lookup.get(point.date + ":" + point.product_id),
    predicted: Number(point.predicted_qty),
  }));
  assert(pairs.every((p) => Number.isFinite(p.actual)));
  assert.equal(pairs.length, 240);
  const scores = metrics(pairs);
  assert.equal(evaluation.accuracy.samples, 240);
  assert(Math.abs(evaluation.accuracy.mae - scores.mae) < 1e-9);
  const weekly = snapshot.points.map((point) => ({
    actual: lookup.get(point.date + ":" + point.product_id),
    predicted: weeklyPrediction(
      snapshot.run.input_history.filter(
        (row) => row.product_id === point.product_id,
      ),
      point.date,
    ),
  }));
  const reconciliation = (
    await db.query(`SELECT
    (SELECT count(*)::int FROM orders WHERE status NOT IN ('completed','cancelled')) AS open_orders,
    (SELECT count(*)::int FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE o.status='completed' AND p.order_id IS NULL) AS unpaid,
    (SELECT count(*)::int FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.amount_satang<>o.total_satang) AS incorrect_payments,
    (SELECT count(*)::int FROM ingredients i WHERE i.current_stock<>(SELECT coalesce(sum(qty),0) FROM stock_movements m WHERE m.ingredient_id=i.id)) AS incorrect_stock,
    (SELECT count(*)::int FROM day_closings) AS closed_days,
    (SELECT count(*)::int FROM stock_movements WHERE type='return') AS stock_returns,
    (SELECT count(*)::int FROM orders WHERE (created_at AT TIME ZONE 'Asia/Bangkok')::date<>(completed_at AT TIME ZONE 'Asia/Bangkok')::date) AS cross_day_deliveries`)
  ).rows[0];
  assert.equal(reconciliation.open_orders, 0);
  assert.equal(reconciliation.unpaid, 0);
  assert.equal(reconciliation.incorrect_payments, 0);
  assert.equal(reconciliation.incorrect_stock, 0);
  assert.equal(reconciliation.closed_days, 211);
  assert(reconciliation.stock_returns > 0);
  assert.equal(reconciliation.cross_day_deliveries, 0);
  const future = await api("owner", "post", "/api/forecasts/generate", {
    date_from: dateOffset(today, 1),
    date_to: dateOffset(today, 30),
    data_mode: "actual",
  });
  const futureSnapshot = await api(
    "owner",
    "get",
    "/api/forecasts/runs/" + future.run_id,
  );
  const after = await fingerprint();
  assert.deepEqual(
    after,
    before,
    "Live shop changed during simulation; investigate concurrent activity",
  );
  const csv =
    [
      "date,product_id,product_name,qty,unit_price,data_origin",
      ...all.map((row) =>
        [
          row.date,
          row.product_id,
          JSON.stringify(products.find((p) => p.id === row.product_id).name),
          row.qty,
          row.unit_price,
          "synthetic",
        ].join(","),
      ),
    ].join("\n") + "\n";
  const report = {
    format: "coffee-sales-simulation-v1",
    synthetic: true,
    production_accuracy_claim: false,
    seed: 20261103,
    database: name,
    started_at: startedAt.toISOString(),
    finished_at: new RealDate().toISOString(),
    period: {
      from: firstDay,
      to: dateOffset(today, -1),
      days: 211,
      training_sale_days: 180,
      issue_day: dateOffset(firstDay, 180),
      holdout_from: dateOffset(firstDay, 181),
      holdout_to: dateOffset(firstDay, 210),
      holdout_days: 30,
      model_history_cap: 120,
    },
    api_calls: apiCalls,
    counters,
    reconciliation,
    holdout_run_id: heldOutRun.run_id,
    holdout_history_sha256: snapshot.run.history_sha256,
    holdout_metrics: scores,
    weekly_baseline_metrics: metrics(weekly),
    future_run_id: future.run_id,
    future_dates: { from: dateOffset(today, 1), to: dateOffset(today, 30) },
    future_points: future.count,
    live_database_unchanged: true,
    export_sha256: createHash("sha256").update(csv).digest("hex"),
    notes: [
      "All demand is generated, not real customers.",
      "API actual means delivered records inside the synthetic database only.",
      "180 completed training sale days precede issue day. Current issue day is excluded by production history contract.",
      "Only 120 most recent complete days are model inputs.",
      "Forecast frozen before generating held-out sales; no test-driven tuning.",
      "Simplified two-ingredient recipes are fixtures; external transactions are not inserted.",
    ],
  };
  await writeFile(resolve(output, "daily.csv"), csv);
  await writeFile(
    resolve(output, "future-30-days.json"),
    JSON.stringify({ synthetic: true, ...futureSnapshot }, null, 2),
  );
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    resolve(".local/simulation/latest.json"),
    JSON.stringify({ database: name, output, synthetic: true }, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(
    resolve(output, "failure.json"),
    JSON.stringify(
      {
        synthetic: true,
        database: name,
        error: error.message,
        counters,
        api_calls: apiCalls,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  globalThis.Date = RealDate;
  if (server) await new Promise((resolve) => server.close(resolve));
  if (model && model.exitCode === null) {
    stopSimulationService(model);
    await new Promise((resolve) => {
      model.once("exit", resolve);
      setTimeout(resolve, 3000).unref();
    });
  }
  await db?.close();
  await source.close();
  await admin.close();
}
