import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { createServer } from "node:net";
import request from "supertest";
import { createApp } from "../dist/app.js";
import { connectDatabase } from "../dist/db.js";
import { readConfig } from "../dist/config.js";
import { migrate } from "../dist/migrate.js";
import { history } from "../dist/shop/forecasts.js";
import { metrics } from "../dist/shop/forecast-metrics.js";
import { backupDatabase } from "./database-backup.mjs";
import { replayDatabase } from "./shop-replay-clock.mjs";
import {
  random,
  demand,
  dateOffset,
  weeklyPrediction,
} from "./simulation-plan.mjs";

if (
  !process.argv.includes("--main-shop") ||
  process.env.NODE_ENV === "production"
)
  throw new Error(
    "Explicit --main-shop is required on a local development shop",
  );
const config = readConfig();
const target = new URL(config.DATABASE_URL);
assert(
  ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname),
  "Local database required",
);
assert(
  !/coffee_(sim|restore)_|test/i.test(target.pathname),
  "Use the configured main shop, not a sandbox",
);
const RealDate = Date,
  startedAt = new RealDate(),
  run = randomUUID();
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(startedAt);
// Leave yesterday's existing transactions alone; all replayed sales precede them.
const first = dateOffset(today, -212),
  last = dateOffset(today, -2);
const output = resolve(".local/shop-replay", run);
await mkdir(output, { recursive: true });
const root = connectDatabase(config.DATABASE_URL);
const lock = new pg.Client({ connectionString: config.DATABASE_URL });
await lock.connect();
let transport,
  server,
  recorded = false,
  clock = Date.parse(first + "T08:00:00+07:00");
const next = random(20261103);
const counters = {
  qr: 0,
  pos: 0,
  completed: 0,
  cancelled_pending: 0,
  cancelled_confirmed: 0,
  refunds: 0,
  stockouts: 0,
  receipts: 0,
  waste: 0,
  duplicate_retries: 0,
  closed_days: 0,
};
let cookie = "",
  calls = 0;
const origin = config.APP_ORIGIN;
async function originalDigest() {
  const result = {};
  for (const table of [
    "orders",
    "payments",
    "stock_movements",
    "day_closings",
    "forecast_runs",
  ])
    result[table] = (
      await root.query(
        `SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS hash FROM ${table} t WHERE simulation_run_id IS NULL`,
      )
    ).rows[0];
  for (const table of [
    "products",
    "product_options",
    "product_option_groups",
    "recipes",
    "recipe_ingredients",
    "recipe_steps",
    "dining_tables",
  ])
    result[table] = (
      await root.query(
        `SELECT count(*)::int AS count,md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY row_to_json(t)::text),'')) AS hash FROM ${table} t`,
      )
    ).rows[0];
  return result;
}
async function time(day, seconds = 8 * 3600) {
  clock = Date.parse(day + "T00:00:00+07:00") + seconds * 1000;
}
async function api(guest, method, path, body, status = 200) {
  calls++;
  let q = request(server)
    [method](path)
    .set("Origin", origin)
    .timeout({ response: 25000, deadline: 30000 });
  if (!guest) q = q.set("Cookie", cookie);
  if (body !== undefined) q = q.send(body);
  const res = await q;
  assert.equal(
    res.status,
    status,
    `${method.toUpperCase()} expected ${status}: ${res.body.error ?? "unexpected status"}`,
  );
  return res.body;
}
async function login() {
  const response = await request(server)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({
      email: process.env.SEED_OWNER_EMAIL,
      password: process.env.SEED_OWNER_PASSWORD,
    });
  assert.equal(
    response.status,
    200,
    "Configured owner login failed; no account password is changed",
  );
  cookie = response.headers["set-cookie"][0].split(";")[0];
}
try {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", () =>
      reject(new Error("Stop the normal API before main-shop replay")),
    );
    probe.listen(config.PORT, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
  assert(
    (await lock.query("SELECT pg_try_advisory_lock(7301020) AS acquired"))
      .rows[0].acquired,
    "Another shop replay is active",
  );
  assert(
    (
      await root.query(
        "SELECT count(*)::int AS n FROM products WHERE NOT is_archived AND is_available",
      )
    ).rows[0].n > 0,
    "Existing menu required",
  );
  const backup = await backupDatabase(
    config.DATABASE_URL,
    resolve(output, "backup"),
  );
  await migrate(root);
  assert.equal(
    (
      await root.query(
        "SELECT count(*)::int AS n FROM shop_simulation_runs WHERE status IN ('running','complete')",
      )
    ).rows[0].n,
    0,
    "A marked main-shop replay already exists; do not duplicate it",
  );
  assert.equal(
    (
      await root.query(
        "SELECT count(*)::int AS n FROM orders WHERE (created_at AT TIME ZONE 'Asia/Bangkok')::date <= $1::date",
        [last],
      )
    ).rows[0].n,
    0,
    "Replay dates overlap original orders",
  );
  assert.equal(
    (
      await root.query(
        "SELECT count(*)::int AS n FROM day_closings WHERE date BETWEEN $1 AND $2",
        [first, last],
      )
    ).rows[0].n,
    0,
    "Replay dates overlap existing closings",
  );
  const owner = (
    await root.query(
      "SELECT id FROM users WHERE email=$1 AND is_active AND role IN ('owner','manager')",
      [process.env.SEED_OWNER_EMAIL],
    )
  ).rows[0];
  assert(owner, "Configured owner/manager required");
  const menu = (
    await root.query(
      "SELECT p.* FROM products p JOIN recipes r ON r.product_id=p.id WHERE p.is_available AND NOT p.is_archived ORDER BY p.name",
    )
  ).rows;
  assert.equal(
    menu.length,
    (
      await root.query(
        "SELECT count(*)::int AS n FROM products WHERE NOT is_archived",
      )
    ).rows[0].n,
    "All unarchived menus must be available and have recipes for this full-shop run",
  );
  const table = (
    await root.query(
      "SELECT id,name,qr_token FROM dining_tables WHERE is_active ORDER BY created_at LIMIT 1",
    )
  ).rows[0];
  assert(table, "An existing active QR table is required");
  const original = await originalDigest();
  const openingStock = (
    await root.query(
      "SELECT id,name,unit,current_stock,reorder_point FROM ingredients ORDER BY id",
    )
  ).rows;
  const recipes = (
    await root.query(
      "SELECT * FROM recipe_ingredients ORDER BY product_id,ingredient_id",
    )
  ).rows;
  const metadata = {
    synthetic: true,
    backup_file: backup.file,
    original_digest: original,
    opening_stock: openingStock,
    catalog: menu,
    recipes,
  };
  await root.query(
    "INSERT INTO shop_simulation_runs(id,date_from,date_to,seed,status,created_by,metadata) VALUES($1,$2,$3,20261103,'running',$4,$5)",
    [run, first, last, owner.id, JSON.stringify(metadata)],
  );
  recorded = true;
  for (const product of menu)
    await root.query(
      "INSERT INTO shop_simulation_products(run_id,product_id) VALUES($1,$2)",
      [run, product.id],
    );
  target.searchParams.set(
    "options",
    (
      (target.searchParams.get("options") ?? "") + " -csynchronous_commit=off"
    ).trim(),
  );
  transport = connectDatabase(target.toString());
  const db = replayDatabase(
    transport,
    () => new RealDate(clock).toISOString(),
    run,
  );
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }
    static now() {
      return clock;
    }
  };
  server = createApp(db, { ...config, SESSION_HOURS: 168 }).listen(
    0,
    "127.0.0.1",
  );
  await new Promise((resolve) => server.once("listening", resolve));
  await login();
  const publicMenu = (
    await api(true, "get", "/api/guest/tables/" + table.qr_token)
  ).products;
  assert.deepEqual(
    new Set(publicMenu.map((p) => p.id)),
    new Set(menu.map((p) => p.id)),
  );
  const stockNames = new Map(openingStock.map((i) => [i.id, i]));
  let heldout, frozen;
  for (let day = 0; day < 211; day++) {
    const date = dateOffset(first, day);
    await time(date);
    if (day && day % 6 === 0) await login();
    if (day === 180) {
      heldout = await api(false, "post", "/api/forecasts/generate", {
        date_from: dateOffset(date, 1),
        date_to: dateOffset(date, 30),
        data_mode: "actual",
      });
      frozen = await api(false, "get", "/api/forecasts/runs/" + heldout.run_id);
      assert(frozen.run.contains_simulated_sales);
      assert.equal(frozen.run.simulation_run_id, run);
      assert(frozen.run.input_history.every((h) => h.date < date));
      assert.equal(
        createHash("sha256")
          .update(frozen.input_history_serialized)
          .digest("hex"),
        frozen.run.history_sha256,
      );
      await writeFile(
        resolve(output, "frozen-holdout.json"),
        JSON.stringify({ synthetic: true, ...frozen }, null, 2),
      );
      console.log("Main shop: 30-day forecast frozen before held-out sales");
    }
    // Selected occasions exercise shortages against the real recipe ingredient.
    if (day % 29 === 10) {
      const ingredient = recipes[0].ingredient_id;
      const balance = Number(
        (
          await root.query(
            "SELECT current_stock FROM ingredients WHERE id=$1",
            [ingredient],
          )
        ).rows[0].current_stock,
      );
      if (balance > 0) {
        await api(
          false,
          "post",
          "/api/stock-movements",
          {
            ingredient_id: ingredient,
            type: "waste",
            qty: balance,
            reason: `[SIMULATION ${run}] shortage scenario`,
          },
          204,
        );
        counters.waste++;
      }
    }
    const quantities = demand(date, day, next),
      queue = [];
    for (const [i, p] of menu.entries())
      for (let left = quantities[i % quantities.length]; left > 0;) {
        const qty = Math.min(left, next() < 0.25 ? 2 : 1);
        left -= qty;
        queue.push({ product: p, qty });
      }
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    for (const [index, { product, qty }] of queue.entries()) {
      const seconds = 9 * 3600 + index * 240;
      assert(
        seconds + 180 < 23 * 3600,
        "Too many orders for one simulated day",
      );
      await time(date, seconds);
      const p = publicMenu.find((m) => m.id === product.id);
      const options = p.option_groups.map(
        (g) => g.options[Math.floor(next() * g.options.length)],
      );
      const item = {
        product_id: p.id,
        qty,
        option_ids: options.map((o) => o.id),
      };
      const guest = next() < 0.6,
        key = randomUUID(),
        tracking = randomBytes(32).toString("hex");
      const note = `[SIMULATION ${run}] replay through existing shop workflow`;
      const body = guest
        ? {
            request_key: key,
            tracking_token: tracking,
            note,
            expected_total_satang:
              (p.price_satang +
                options.reduce((s, o) => s + o.extra_price_satang, 0)) *
              qty,
            items: [item],
          }
        : {
            request_key: key,
            type: "dine-in",
            table_no: table.name,
            note,
            items: [item],
          };
      const path = guest
        ? "/api/guest/tables/" + table.qr_token + "/orders"
        : "/api/orders";
      await api(guest, "post", path, body, 201);
      counters[guest ? "qr" : "pos"]++;
      const id = (
        await root.query(
          "SELECT id,simulation_run_id FROM orders WHERE request_key=$1",
          [key],
        )
      ).rows[0];
      assert.equal(id.simulation_run_id, run);
      if (index === 0) {
        await api(guest, "post", path, body, 201);
        counters.duplicate_retries++;
      }
      const scenario = next();
      if (scenario < 0.025) {
        await api(false, "post", `/api/orders/${id.id}/status`, {
          status: "cancelled",
          reason: note,
        });
        counters.cancelled_pending++;
        continue;
      }
      const detail = (await api(false, "get", `/api/orders/${id.id}`)).order;
      const required = new Map();
      for (const line of detail.items)
        for (const ingredient of line.ingredients)
          required.set(
            ingredient.ingredient_id,
            Math.round(
              ((required.get(ingredient.ingredient_id) ?? 0) +
                Number(ingredient.qty) * line.qty) *
                1000,
            ) / 1000,
          );
      const balances = (
        await root.query(
          "SELECT id,current_stock FROM ingredients WHERE id=ANY($1::uuid[])",
          [[...required.keys()]],
        )
      ).rows;
      const shortage = balances.some(
        (i) => Number(i.current_stock) < required.get(i.id),
      );
      if (shortage) {
        await api(false, "post", `/api/orders/${id.id}/confirm`, {}, 409);
        counters.stockouts++;
        for (const ingredient of balances)
          if (Number(ingredient.current_stock) < required.get(ingredient.id)) {
            const info = stockNames.get(ingredient.id);
            const targetStock = Math.max(
              Number(info.reorder_point) * 3,
              required.get(ingredient.id) * 20,
              20,
            );
            const receipt =
              Math.ceil(
                (targetStock - Number(ingredient.current_stock)) * 1000,
              ) / 1000;
            await api(
              false,
              "post",
              "/api/stock-movements",
              {
                ingredient_id: ingredient.id,
                type: "receipt",
                qty: receipt,
                reason: `[SIMULATION ${run}] replenishment using shop recipe`,
              },
              204,
            );
            counters.receipts++;
          }
      }
      await api(false, "post", `/api/orders/${id.id}/confirm`, {});
      if (index === 0)
        await api(false, "post", `/api/orders/${id.id}/confirm`, {});
      if (scenario < 0.05) {
        await api(false, "post", `/api/orders/${id.id}/status`, {
          status: "cancelled",
          reason: note,
        });
        counters.cancelled_confirmed++;
        continue;
      }
      await time(date, seconds + 30);
      for (const line of detail.items)
        await api(
          false,
          "post",
          `/api/kds/items/${line.id}/status`,
          { status: "preparing" },
          204,
        );
      if (scenario < 0.07) {
        await api(false, "post", `/api/orders/${id.id}/pay`, {
          method: "cash",
        });
        await api(false, "post", `/api/orders/${id.id}/status`, {
          status: "cancelled",
          reason: note,
          confirm_refund: true,
        });
        counters.refunds++;
        continue;
      }
      await time(date, seconds + 120);
      for (const line of detail.items)
        await api(
          false,
          "post",
          `/api/kds/items/${line.id}/status`,
          { status: "ready" },
          204,
        );
      await api(false, "post", `/api/orders/${id.id}/status`, {
        status: "completed",
      });
      if (guest) {
        const state = (await api(true, "get", "/api/guest/orders/" + tracking))
          .order;
        assert.equal(state.status, "completed");
        assert.equal(state.payment_status, null);
      }
      await time(date, seconds + 180);
      const method = next() < 0.45 ? "cash" : "promptpay";
      await api(false, "post", `/api/orders/${id.id}/pay`, { method });
      if (index === 0)
        await api(false, "post", `/api/orders/${id.id}/pay`, { method });
      counters.completed++;
    }
    await time(date, 23 * 3600);
    const report = await api(
      false,
      "get",
      `/api/reports?date_from=${date}&date_to=${date}`,
    );
    assert.equal(
      Number(report.summary.revenue_satang),
      Number(report.summary.cash_satang) +
        Number(report.summary.promptpay_satang),
    );
    await api(
      false,
      "post",
      "/api/reports/close",
      { date, note: `[SIMULATION ${run}]` },
      204,
    );
    counters.closed_days++;
    if (day % 15 === 14) {
      console.log(
        `Main shop replay: ${day + 1}/211 days, ${counters.completed} completed, ${calls} API checks`,
      );
      await root.query(
        "UPDATE shop_simulation_runs SET metadata=metadata || $2::jsonb WHERE id=$1",
        [run, JSON.stringify({ completed_days: day + 1, counters })],
      );
    }
  }
  await time(today);
  await login();
  const observations = await history(db, "actual");
  const lookup = new Map(
    observations.map((h) => [h.date + ":" + h.product_id, Number(h.qty)]),
  );
  const pairs = frozen.points.map((p) => ({
    actual: lookup.get(p.date + ":" + p.product_id),
    predicted: Number(p.predicted_qty),
  }));
  assert(pairs.every((p) => Number.isFinite(p.actual)));
  assert.equal(pairs.length, menu.length * 30);
  const baseline = frozen.points.map((p) => ({
    actual: lookup.get(p.date + ":" + p.product_id),
    predicted: weeklyPrediction(
      frozen.run.input_history.filter((h) => h.product_id === p.product_id),
      p.date,
    ),
  }));
  const evaluation = await api(
    false,
    "get",
    `/api/forecasts?date_from=${dateOffset(first, 181)}&date_to=${last}&run_id=${heldout.run_id}&data_mode=actual`,
  );
  const simulationScore = evaluation.evaluation.by_source.find(
    (e) => e.source === "simulation",
  );
  assert.equal(simulationScore.samples, menu.length * 30);
  assert.equal(evaluation.accuracy.samples, 0);
  assert(Math.abs(simulationScore.mae - metrics(pairs).mae) < 1e-9);
  const future = await api(false, "post", "/api/forecasts/generate", {
    date_from: dateOffset(today, 1),
    date_to: dateOffset(today, 30),
    data_mode: "actual",
  });
  const futureSnapshot = await api(
    false,
    "get",
    "/api/forecasts/runs/" + future.run_id,
  );
  assert.deepEqual(
    await originalDigest(),
    original,
    "Original shop records/catalog must remain unchanged",
  );
  const reconciliation = (
    await root.query(
      `SELECT
    (SELECT count(*)::int FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE o.simulation_run_id=$1 AND (o.status NOT IN ('completed','cancelled') OR (o.status='completed' AND p.order_id IS NULL))) AS unfinished,
    (SELECT count(*)::int FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.simulation_run_id=$1 AND p.amount_satang<>o.total_satang) AS wrong_payments,
    (SELECT count(*)::int FROM ingredients i WHERE abs(i.current_stock-(SELECT coalesce(sum(qty),0) FROM stock_movements m WHERE m.ingredient_id=i.id))>.0001) AS wrong_stock,
    (SELECT count(*)::int FROM day_closings WHERE simulation_run_id=$1) AS closed_days`,
      [run],
    )
  ).rows[0];
  assert.equal(reconciliation.unfinished, 0);
  assert.equal(reconciliation.wrong_payments, 0);
  assert.equal(reconciliation.wrong_stock, 0);
  assert.equal(reconciliation.closed_days, 211);
  const summary = {
    synthetic: true,
    main_shop: true,
    run_id: run,
    started_at: startedAt.toISOString(),
    finished_at: new RealDate().toISOString(),
    date_from: first,
    date_to: last,
    menus: menu.map((p) => ({ id: p.id, name: p.name })),
    counters,
    api_calls: calls,
    reconciliation,
    holdout_run_id: heldout.run_id,
    holdout_dates: { from: dateOffset(first, 181), to: last },
    holdout_metrics: metrics(pairs),
    weekly_metrics: metrics(baseline),
    future_run_id: future.run_id,
    future_dates: { from: dateOffset(today, 1), to: dateOffset(today, 30) },
    original_records_unchanged: true,
    backup_file: backup.file,
  };
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(summary, null, 2),
  );
  await writeFile(
    resolve(output, "future-30-days.json"),
    JSON.stringify({ synthetic: true, ...futureSnapshot }, null, 2),
  );
  await writeFile(
    resolve(".local/shop-replay/latest.json"),
    JSON.stringify(
      { run_id: run, output, synthetic: true, main_shop: true },
      null,
      2,
    ),
  );
  // Normal synchronous root connection flushes prior replay WAL before completion.
  await root.query(
    "UPDATE shop_simulation_runs SET status='complete',completed_at=now(),metadata=metadata || $2::jsonb WHERE id=$1",
    [run, JSON.stringify({ report: summary })],
  );
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  if (recorded)
    await root.query(
      "UPDATE shop_simulation_runs SET status='failed',completed_at=now(),metadata=metadata || $2::jsonb WHERE id=$1",
      [run, JSON.stringify({ error: error.message, counters })],
    );
  await writeFile(
    resolve(output, "failure.json"),
    JSON.stringify(
      { run_id: run, main_shop: true, error: error.message, counters },
      null,
      2,
    ),
  );
  throw error;
} finally {
  globalThis.Date = RealDate;
  if (server) await new Promise((resolve) => server.close(resolve));
  await transport?.close();
  await root.close();
  await lock.end();
}
