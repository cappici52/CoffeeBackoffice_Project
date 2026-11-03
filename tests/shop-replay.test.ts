import { randomUUID } from "node:crypto";
import request from "supertest";
import { expect, test } from "vitest";
import { testDatabase } from "./database.js";
import { migrate } from "../src/migrate.js";
import { seedOwner } from "../src/seed.js";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { history } from "../src/shop/forecasts.js";
import { replayDatabase } from "../scripts/shop-replay-clock.mjs";

test("replay runs real order, stock, refund and closing handlers with marked historical events while ordinary DB time stays real", async () => {
  const fixture = await testDatabase();
  try {
    const db = fixture.db;
    await migrate(db);
    await seedOwner(db, "owner@example.com", "Coffee-test-password1");
    const owner = (await db.query("SELECT id FROM users LIMIT 1")).rows[0]!.id;
    const run = randomUUID(),
      category = randomUUID(),
      ingredient = randomUUID(),
      product = randomUUID();
    await db.query(
      "INSERT INTO shop_simulation_runs(id,date_from,date_to,seed,status,created_by) VALUES($1,'2026-04-01','2026-04-02',42,'running',$2)",
      [run, owner],
    );
    await db.query(
      "INSERT INTO categories(id,name) VALUES($1,'Original category')",
      [category],
    );
    await db.query(
      "INSERT INTO ingredients(id,name,unit,cost_satang) VALUES($1,'Original stock','g',100)",
      [ingredient],
    );
    await db.query(
      "INSERT INTO products(id,category_id,name,price_satang,station) VALUES($1,$2,'Original menu',6500,'bar')",
      [product, category],
    );
    await db.query("INSERT INTO recipes(product_id) VALUES($1)", [product]);
    await db.query(
      "INSERT INTO recipe_ingredients(product_id,ingredient_id,qty) VALUES($1,$2,18)",
      [product, ingredient],
    );
    await db.query(
      "INSERT INTO shop_simulation_products(run_id,product_id) VALUES($1,$2)",
      [run, product],
    );
    const replay = replayDatabase(db, () => "2026-04-01T05:00:00.000Z", run);
    const app = createApp(
      replay,
      readConfig({ DATABASE_URL: "postgresql://test:test@localhost/test" }),
    );
    const origin = "http://localhost:3001";
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: "owner@example.com", password: "Coffee-test-password1" })
      .expect(200);
    const cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
    const post = (path: string, data: object) =>
      request(app)
        .post("/api" + path)
        .set("Origin", origin)
        .set("Cookie", cookie)
        .send(data);
    await post("/stock-movements", {
      ingredient_id: ingredient,
      type: "receipt",
      qty: 100,
      reason: "SIMULATED",
    }).expect(204);
    const created = await post("/orders", {
      request_key: randomUUID(),
      type: "dine-in",
      table_no: "1",
      note: "SIMULATION",
      items: [{ product_id: product, qty: 1 }],
    }).expect(201);
    const order = created.body.order;
    expect(order.simulation_run_id).toBe(run);
    expect(new Date(order.created_at).toISOString()).toBe(
      "2026-04-01T05:00:00.000Z",
    );
    await post(`/orders/${order.id}/confirm`, {}).expect(200);
    await post(`/orders/${order.id}/confirm`, {}).expect(200);
    await post(`/orders/${order.id}/pay`, { method: "cash" }).expect(200);
    await post(`/orders/${order.id}/status`, {
      status: "cancelled",
      reason: "SIMULATION",
      confirm_refund: true,
    }).expect(200);
    expect(
      Number(
        (
          await db.query("SELECT current_stock FROM ingredients WHERE id=$1", [
            ingredient,
          ])
        ).rows[0]!.current_stock,
      ),
    ).toBe(100);
    const payment = (
      await db.query("SELECT * FROM payments WHERE order_id=$1", [order.id])
    ).rows[0]!;
    expect(payment.simulation_run_id).toBe(run);
    expect(new Date(payment.paid_at).toISOString()).toBe(
      "2026-04-01T05:00:00.000Z",
    );
    const stock = (
      await db.query("SELECT created_at FROM stock_movements LIMIT 1")
    ).rows[0]!;
    expect(new Date(stock.created_at).getUTCFullYear()).toBe(
      new Date().getUTCFullYear(),
    );
    await post("/reports/close", { date: "2026-04-01" }).expect(204);
    // Zero observation is explicit in this marked replay even before menu creation.
    expect(
      (await history(db, "actual")).some((h) => h.date === "2026-04-01"),
    ).toBe(false); // outside current 120-day window
    expect((await history(replay, "actual")).length).toBe(0); // current day excluded
    const nextDay = replayDatabase(db, () => "2026-04-02T05:00:00.000Z", run);
    const observations = await history(nextDay, "actual");
    expect(observations).toHaveLength(1);
    expect(Number(observations[0]!.qty)).toBe(0);
    const context = await request(app)
      .get("/api/shop-context")
      .set("Cookie", cookie)
      .expect(200);
    expect(context.body.contains_simulation).toBe(true);
    expect(
      (await db.query("SELECT now()::text AS instant")).rows[0]!.instant,
    ).not.toContain("2026-04-01");
  } finally {
    await fixture.close();
  }
}, 30000);
