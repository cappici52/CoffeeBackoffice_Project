import { beforeAll, afterAll, expect, test } from "vitest";
import request from "supertest";
import QRCode from "qrcode";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { seedOwner } from "../src/seed.js";
import { testDatabase } from "./database.js";
let fixture: Awaited<ReturnType<typeof testDatabase>>,
  app: ReturnType<typeof createApp>,
  cookie: string,
  image: Buffer;
const origin = "http://localhost:3001";
function payload(amount = "") {
  const tlv = (tag: string, value: string) =>
    tag + String(value.length).padStart(2, "0") + value;
  const base =
    tlv("00", "01") +
    tlv("01", "11") +
    tlv("29", tlv("00", "A000000677010111") + tlv("01", "0066000000000")) +
    tlv("53", "764") +
    (amount ? tlv("54", amount) : "") +
    tlv("58", "TH") +
    "6304";
  let crc = 0xffff;
  for (const c of base) {
    crc ^= c.charCodeAt(0) << 8;
    for (let i = 0; i < 8; i++)
      crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return base + crc.toString(16).padStart(4, "0").toUpperCase();
}
const upload = (body: Buffer) =>
  request(app)
    .put("/api/payment-qr")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .set("Content-Type", "image/png")
    .send(body);
beforeAll(async () => {
  fixture = await testDatabase();
  await migrate(fixture.db);
  await seedOwner(fixture.db, "owner@example.com", "Coffee-owner-password1");
  app = createApp(
    fixture.db,
    readConfig({ DATABASE_URL: "postgresql://test:test@localhost/test" }),
  );
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({ email: "owner@example.com", password: "Coffee-owner-password1" })
    .expect(200);
  cookie = login.headers["set-cookie"]![0]!.split(";")[0]!;
  image = await QRCode.toBuffer(payload(), { width: 500, margin: 4 });
}, 30000);
afterAll(async () => fixture?.close());
test("payment QR is staff-only and absent settings do not break manual checkout", async () => {
  await request(app).get("/api/payment-qr").expect(401);
  const empty = await request(app)
    .get("/api/payment-qr")
    .set("Cookie", cookie)
    .expect(200);
  expect(empty.body.available).toBe(false);
  await request(app)
    .get("/api/payment-qr/image")
    .set("Cookie", cookie)
    .expect(404);
});
test("stores the original bank QR bytes, reports static amount and audits the update", async () => {
  const saved = await upload(image).expect(200);
  expect(saved.body.fixed_amount_satang).toBeNull();
  const metadata = await request(app)
    .get("/api/payment-qr")
    .set("Cookie", cookie)
    .expect(200);
  expect(metadata.body.available).toBe(true);
  const original = await request(app)
    .get(metadata.body.image_url)
    .set("Cookie", cookie)
    .expect(200);
  expect(Buffer.from(original.body).equals(image)).toBe(true);
  expect(original.headers["cache-control"]).toBe("no-store");
  expect(
    (
      await fixture.db.query(
        "SELECT id FROM audit_logs WHERE action='payment.qr.updated'",
      )
    ).rows,
  ).toHaveLength(1);
});
test("rejects invalid QR images without overwriting the configured original and detects fixed amounts", async () => {
  await upload(Buffer.from("not a PNG")).expect(400);
  await upload(
    await QRCode.toBuffer("not a payment payload", { width: 500 }),
  ).expect(400);
  await upload(
    await QRCode.toBuffer(payload().slice(0, -4) + "0000", { width: 500 }),
  ).expect(400);
  expect(
    Buffer.from(
      (await fixture.db.query("SELECT image FROM payment_qr")).rows[0]!.image,
    ).equals(image),
  ).toBe(true);
  const fixed = await upload(
    await QRCode.toBuffer(payload("75.00"), { width: 500, margin: 4 }),
  ).expect(200);
  expect(Number(fixed.body.fixed_amount_satang)).toBe(7500);
});

test("cashiers can show the QR while kitchen and customer sessions cannot access it", async () => {
  for (const role of ["cashier", "kitchen"]) {
    await request(app)
      .post("/api/users")
      .set("Origin", origin)
      .set("Cookie", cookie)
      .send({
        email: role + "@example.com",
        name: role,
        role,
        password: "Coffee-staff-password1",
      })
      .expect(201);
    const login = await request(app)
      .post("/api/auth/login")
      .set("Origin", origin)
      .send({
        email: role + "@example.com",
        password: "Coffee-staff-password1",
      })
      .expect(200);
    const staff = login.headers["set-cookie"]![0]!.split(";")[0]!;
    await request(app)
      .get("/api/payment-qr")
      .set("Cookie", staff)
      .expect(role === "cashier" ? 200 : 403);
    await request(app)
      .get("/api/payment-qr/image")
      .set("Cookie", staff)
      .expect(role === "cashier" ? 200 : 403);
    await request(app)
      .put("/api/payment-qr")
      .set("Origin", origin)
      .set("Cookie", staff)
      .set("Content-Type", "image/png")
      .send(image)
      .expect(403);
  }
});
