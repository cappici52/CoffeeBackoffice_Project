import { afterAll, beforeAll, expect, test } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { migrate } from "../src/migrate.js";
import { seedOwner } from "../src/seed.js";
import { testDatabase } from "./database.js";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof createApp>;
let cookie: string;
let image: Buffer;
let savedUrl: string;
const origin = "http://localhost:3001";
const upload = (data: Buffer, type = "image/jpeg") =>
  request(app)
    .post("/api/menu-images")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .set("Content-Type", type)
    .send(data);
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
  image = await sharp({
    create: { width: 1800, height: 900, channels: 3, background: "#aaa" },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { Artist: "Test private metadata" } } })
    .toBuffer();
}, 30000);
afterAll(async () => fixture?.close());

test("uploads require staff management permission and the configured origin", async () => {
  await request(app)
    .post("/api/menu-images")
    .set("Origin", origin)
    .set("Content-Type", "image/jpeg")
    .send(image)
    .expect(401);
  await request(app)
    .post("/api/menu-images")
    .set("Cookie", cookie)
    .set("Content-Type", "image/jpeg")
    .send(image)
    .expect(403);
  const created = await request(app)
    .post("/api/users")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({
      email: "cashier@example.com",
      name: "Cashier",
      role: "cashier",
      password: "Coffee-cashier-password1",
    })
    .expect(201);
  expect(created.body.user.role).toBe("cashier");
  const login = await request(app)
    .post("/api/auth/login")
    .set("Origin", origin)
    .send({
      email: "cashier@example.com",
      password: "Coffee-cashier-password1",
    })
    .expect(200);
  await request(app)
    .post("/api/menu-images")
    .set("Origin", origin)
    .set("Cookie", login.headers["set-cookie"]![0]!.split(";")[0]!)
    .set("Content-Type", "image/jpeg")
    .send(image)
    .expect(403);
});

test("photos are decoded, resized, stripped of private metadata, deduplicated and publicly served", async () => {
  const saved = await upload(image).expect(201);
  savedUrl = saved.body.image_url;
  expect(savedUrl).toMatch(/^\/api\/menu-images\/[a-f0-9]{64}\.webp$/);
  expect((await upload(image).expect(201)).body.image_url).toBe(savedUrl);
  const response = await request(app)
    .get(savedUrl)
    .expect(200)
    .expect("Content-Type", /image\/webp/);
  expect(response.headers["cache-control"]).toContain("immutable");
  const meta = await sharp(response.body).metadata();
  expect(meta.width).toBe(1600);
  expect(meta.height).toBe(800);
  expect(meta.exif).toBeUndefined();
  await request(app)
    .get(savedUrl)
    .set("If-None-Match", response.headers.etag!)
    .expect(304);
  expect(
    (await fixture.db.query("SELECT hash FROM menu_images")).rows,
  ).toHaveLength(1);
  expect(
    (
      await fixture.db.query(
        "SELECT id FROM audit_logs WHERE action='menu_image.upload'",
      )
    ).rows,
  ).toHaveLength(1);
});

test("invalid, oversized and active-content files cannot become public images", async () => {
  await upload(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ),
  ).expect(400);
  await upload(image, "image/svg+xml").expect(400);
  await upload(image.subarray(0, 50)).expect(400);
  await upload(Buffer.alloc(5 * 1024 * 1024 + 1)).expect(413);
  const large = await sharp({
    create: { width: 5100, height: 5000, channels: 3, background: "#aaa" },
  })
    .png()
    .toBuffer();
  await upload(large, "image/png").expect(400);
  await request(app).get("/api/menu-images/anything.svg").expect(404);
  await request(app)
    .get(`/api/menu-images/${"0".repeat(64)}.webp`)
    .expect(404);
  expect(
    (await fixture.db.query("SELECT hash FROM menu_images")).rows,
  ).toHaveLength(1);
});

test("uploaded image URLs can be saved in catalog products without allowing arbitrary local paths", async () => {
  const category = await request(app)
    .post("/api/categories")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ name: "Coffee" })
    .expect(201);
  const product = await request(app)
    .post("/api/products")
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({
      category_id: category.body.category.id,
      name: "Latte",
      price_satang: 7500,
      image_url: savedUrl,
    })
    .expect(201);
  expect(product.body.product.image_url).toBe(savedUrl);
  const catalog = await request(app)
    .get("/api/catalog")
    .set("Cookie", cookie)
    .expect(200);
  expect(catalog.body.products[0].image_url).toBe(savedUrl);
  await request(app)
    .patch("/api/products/" + product.body.product.id)
    .set("Origin", origin)
    .set("Cookie", cookie)
    .send({ image_url: "/api/menu-images/../../auth/me", expected_version: 1 })
    .expect(400);
});
