import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { seedOwner } from "../src/seed.js";
import { newToken, tokenHash } from "../src/security.js";
import { testDatabase } from "./database.js";

const origin = "http://localhost:3001";
const guestOrigin = "http://192.168.1.33:3001";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof createApp>;
let owner: string;
let cashier: string;
let kitchen: string;
let tableId: string;
let qr: string;
let product: string;
let ingredient: string;
let option: string;
let body: ReturnType<typeof orderBody>;
let main: any;
const admin = (path: string, payload: object) =>
  request(app)
    .post("/api" + path)
    .set("Origin", origin)
    .set("Cookie", owner)
    .send(payload);
const guest = (payload: object, tableToken = qr) =>
  request(app)
    .post("/api/guest/tables/" + tableToken + "/orders")
    .set("Origin", guestOrigin)
    .send(payload);
function orderBody() {
  return {
    request_key: randomUUID(),
    tracking_token: newToken(),
    expected_total_satang: 8000,
    note: "ไม่ใส่น้ำแข็ง",
    items: [
      { product_id: product, qty: 1, option_ids: [option], note: "แก้วสะอาด" },
    ],
  };
}
beforeAll(async () => {
  fixture = await testDatabase();
  await migrate(fixture.db);
  await seedOwner(fixture.db, "owner@example.com", "Coffee-test-password1");
  app = createApp(
    fixture.db,
    readConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      APP_ORIGIN: origin,
      PUBLIC_ORIGIN: guestOrigin,
    }),
  );
  const hash = (
    await fixture.db.query("SELECT password_hash FROM users LIMIT 1")
  ).rows[0]?.password_hash;
  for (const role of ["cashier", "kitchen"])
    await fixture.db.query(
      "INSERT INTO users (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$2)",
      [randomUUID(), role, role + "@example.com", hash],
    );
  async function login(role: string) {
    const r = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({ email: role + "@example.com", password: "Coffee-test-password1" })
      .expect(200);
    return r.headers["set-cookie"]![0]!.split(";")[0]!;
  }
  owner = await login("owner");
  cashier = await login("cashier");
  kitchen = await login("kitchen");
  tableId = (await admin("/tables", { name: "1" }).expect(201)).body.id;
  qr = (await request(app).get("/api/tables").set("Cookie", owner).expect(200))
    .body.tables[0].qr_token;
  const category = (await admin("/categories", { name: "กาแฟ" }).expect(201))
    .body.category.id;
  ingredient = (
    await admin("/ingredients", {
      name: "เมล็ด",
      unit: "g",
      reorder_point: 10,
      cost_satang: 100,
    }).expect(201)
  ).body.id;
  await admin("/stock-movements", {
    ingredient_id: ingredient,
    type: "receipt",
    qty: 1000,
    reason: "ตั้งต้น",
  }).expect(204);
  const p = (
    await admin("/products", {
      category_id: category,
      name: "ลาเต้",
      price_satang: 7500,
      option_groups: [
        {
          name: "ขนาด",
          is_required: true,
          multi_select: false,
          options: [{ name: "ใหญ่", extra_price_satang: 500 }],
        },
      ],
    }).expect(201)
  ).body.product;
  product = p.id;
  option = p.option_groups[0].options[0].id;
  await request(app)
    .put("/api/recipes/" + product)
    .set("Origin", origin)
    .set("Cookie", owner)
    .send({
      expected_version: 0,
      ingredients: [{ ingredient_id: ingredient, qty: 18 }],
      steps: [{ instruction: "ขั้นตอนลับ" }],
    })
    .expect(204);
}, 30000);
afterAll(async () => fixture?.close());
test("QR management requires owner/manager; customer menu reveals only menu data", async () => {
  await request(app).get("/api/tables").expect(401);
  for (const session of [cashier, kitchen])
    await request(app).get("/api/tables").set("Cookie", session).expect(403);
  const tables = await request(app)
    .get("/api/tables")
    .set("Cookie", owner)
    .expect(200);
  expect(tables.body.tables[0].menu_url).toBe(guestOrigin + "/table/" + qr);
  const menu = await request(app)
    .get("/api/guest/tables/" + qr)
    .expect(200);
  expect(menu.body.table.name).toBe("1");
  expect(menu.body.products[0].price_satang).toBe(7500);
  expect(JSON.stringify(menu.body)).not.toMatch(
    /cost_satang|ingredients|replaces_ingredient_id|qr_token|password|recipe_steps/,
  );
  await request(app).get("/api/catalog").expect(401);
  await request(app).get("/api/ingredients").expect(401);
});
test("guest order is bound to its QR table and cannot set payment, price or another table", async () => {
  for (const extra of [
    { payment_method: "cash" },
    { table_no: "99" },
    { total_satang: 1 },
    { created_by: randomUUID() },
  ])
    await guest({ ...orderBody(), ...extra }).expect(400);
  body = orderBody();
  main = (await guest(body).expect(201)).body.order;
  expect(main.table_no).toBe("1");
  expect(main.total_satang).toBe(8000);
  expect(main.payment_status).toBeNull();
  expect(main.status).toBe("pending");
  const stored = (
    await fixture.db.query("SELECT * FROM orders WHERE request_key=$1", [
      body.request_key,
    ])
  ).rows[0]!;
  expect(stored.created_by).toBeNull();
  expect(stored.source).toBe("qr");
  expect(stored.dining_table_id).toBe(tableId);
  expect(stored.guest_tracking_hash).toBe(tokenHash(body.tracking_token));
  expect(stored.guest_tracking_hash).not.toBe(body.tracking_token);
  expect(
    Number(
      (
        await fixture.db.query(
          "SELECT current_stock FROM ingredients WHERE id=$1",
          [ingredient],
        )
      ).rows[0]?.current_stock,
    ),
  ).toBe(1000);
  const kds = (
    await request(app).get("/api/kds").set("Cookie", kitchen).expect(200)
  ).body;
  expect(kds.orders).toHaveLength(0);
});
test("lost responses and simultaneous retries create one order without accepting changed payloads", async () => {
  const [a, b] = await Promise.all([guest(body), guest(body)]);
  expect(a.status).toBe(201);
  expect(b.status).toBe(201);
  expect(a.body.order.order_no).toBe(main.order_no);
  expect((await fixture.db.query("SELECT id FROM orders")).rows).toHaveLength(
    1,
  );
  await guest({ ...body, note: "different" }).expect(409);
  await guest({ ...body, tracking_token: newToken() }).expect(409);
});
test("changed quotes cannot silently change the customer total; cancelled orders remain trackable", async () => {
  await guest({ ...orderBody(), expected_total_satang: 1 }).expect(409, {
    error: "MENU_PRICE_CHANGED",
  });
  const payload = orderBody();
  await guest(payload).expect(201);
  const id = (
    await fixture.db.query("SELECT id FROM orders WHERE request_key=$1", [
      payload.request_key,
    ])
  ).rows[0]?.id;
  await request(app)
    .post("/api/orders/" + id + "/status")
    .set("Origin", origin)
    .set("Cookie", cashier)
    .send({ status: "cancelled", reason: "ลูกค้าขอยกเลิก" })
    .expect(200);
  const track = (
    await request(app)
      .get("/api/guest/orders/" + payload.tracking_token)
      .expect(200)
  ).body.order;
  expect(track.status).toBe("cancelled");
  expect(track.cancel_reason).toBe("ลูกค้าขอยกเลิก");
});
test("tracking needs an independent order capability; QR knowledge and IDs cannot list others", async () => {
  const tracked = await request(app)
    .get("/api/guest/orders/" + body.tracking_token)
    .expect(200);
  expect(tracked.body.order.order_no).toBe(main.order_no);
  expect(tracked.headers["cache-control"]).toBe("no-store");
  expect(tracked.headers["referrer-policy"]).toBe("no-referrer");
  expect(JSON.stringify(tracked.body)).not.toMatch(
    /cost_satang|ingredients|steps|request_key|tracking_hash|created_by|confirmed_by|password/,
  );
  await request(app)
    .get("/api/guest/orders/" + qr)
    .expect(404);
  await request(app)
    .get("/api/guest/orders/" + newToken())
    .expect(404);
  await request(app)
    .get("/api/guest/tables/" + qr + "/orders")
    .expect(404);
});
test("payment and KDS transitions are reflected to only that customer; stock deducted once", async () => {
  const stored = (
    await fixture.db.query("SELECT id FROM orders WHERE request_key=$1", [
      body.request_key,
    ])
  ).rows[0]!;
  const detail = await request(app)
    .get("/api/orders/" + stored.id)
    .set("Cookie", cashier)
    .expect(200);
  expect(detail.body.order.created_by_name).toBe("ลูกค้าสแกน QR");
  const item = detail.body.order.items[0].id;
  await request(app)
    .post("/api/kds/items/" + item + "/status")
    .set("Origin", origin)
    .set("Cookie", kitchen)
    .send({ status: "preparing" })
    .expect(409);
  await request(app)
    .post("/api/orders/" + stored.id + "/pay")
    .set("Origin", origin)
    .set("Cookie", cashier)
    .send({ method: "cash" })
    .expect(200);
  const paid = (
    await request(app).get("/api/guest/orders/" + body.tracking_token)
  ).body.order;
  expect(paid.payment_status).toBe("paid");
  for (const status of ["preparing", "ready"]) {
    await request(app)
      .post("/api/kds/items/" + item + "/status")
      .set("Origin", origin)
      .set("Cookie", kitchen)
      .send({ status })
      .expect(204);
    expect(
      (await request(app).get("/api/guest/orders/" + body.tracking_token)).body
        .order.status,
    ).toBe(status);
  }
  await request(app)
    .post("/api/orders/" + stored.id + "/status")
    .set("Origin", origin)
    .set("Cookie", cashier)
    .send({ status: "completed" })
    .expect(200);
  expect(
    (await request(app).get("/api/guest/orders/" + body.tracking_token)).body
      .order.status,
  ).toBe("completed");
  expect(
    Number(
      (
        await fixture.db.query(
          "SELECT current_stock FROM ingredients WHERE id=$1",
          [ingredient],
        )
      ).rows[0]?.current_stock,
    ),
  ).toBe(982);
});
test("disabling/rotating a QR blocks new orders while keeping existing customer tracking", async () => {
  await request(app)
    .patch("/api/tables/" + tableId)
    .set("Origin", origin)
    .set("Cookie", owner)
    .send({ name: "A1", is_active: false, expected_version: 1 })
    .expect(204);
  await request(app)
    .get("/api/guest/tables/" + qr)
    .expect(404);
  await guest(orderBody()).expect(404);
  await request(app)
    .get("/api/guest/orders/" + body.tracking_token)
    .expect(200);
  await request(app)
    .patch("/api/tables/" + tableId)
    .set("Origin", origin)
    .set("Cookie", owner)
    .send({ name: "A1", is_active: true, expected_version: 2 })
    .expect(204);
  await admin("/tables/" + tableId + "/rotate", { expected_version: 3 }).expect(
    204,
  );
  await request(app)
    .get("/api/guest/tables/" + qr)
    .expect(404);
  await admin("/tables/" + tableId + "/rotate", { expected_version: 3 }).expect(
    409,
  );
  qr = (await request(app).get("/api/tables").set("Cookie", owner)).body
    .tables[0].qr_token;
  expect(
    (await request(app).get("/api/guest/orders/" + body.tracking_token)).body
      .order.table_no,
  ).toBe("1");
});
test("untrusted origins and invalid options are rejected; pending guest orders are bounded", async () => {
  await request(app)
    .post("/api/guest/tables/" + qr + "/orders")
    .send(orderBody())
    .expect(403);
  await request(app)
    .post("/api/guest/tables/" + qr + "/orders")
    .set("Origin", "https://evil.example")
    .send(orderBody())
    .expect(403);
  await guest({
    ...orderBody(),
    items: [{ product_id: product, qty: 1, option_ids: [] }],
  }).expect(400);
  for (let i = 0; i < 10; i++) await guest(orderBody()).expect(201);
  await guest(orderBody()).expect(429, { error: "TABLE_ORDER_LIMIT" });
});
