import { afterAll, beforeAll, expect, test } from "vitest";
import request from "supertest";
import { testDatabase } from "./database.js";
import { migrate } from "../src/migrate.js";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  fixture = await testDatabase();
  await migrate(fixture.db);
}, 30_000);
afterAll(async () => fixture?.close());
test("migrations are repeatable and health checks the database", async () => {
  await migrate(fixture.db);
  expect(
    (await fixture.db.query("SELECT name FROM schema_migrations")).rows.length,
  ).toBeGreaterThanOrEqual(2);
  const app = createApp(
    fixture.db,
    readConfig({ DATABASE_URL: "postgresql://test:test@localhost/test" }),
  );
  await request(app).get("/api/health").expect(200, { status: "ok" });
});
test("production requires a secure origin", () => {
  expect(() =>
    readConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      NODE_ENV: "production",
    }),
  ).toThrow("HTTPS");
});
test("LAN development keeps HTTP assets working while production retains HTTPS upgrade headers", async () => {
  const development = createApp(
    fixture.db,
    readConfig({ DATABASE_URL: "postgresql://test:test@localhost/test" }),
  );
  const dev = await request(development).get("/api/health").expect(200);
  expect(dev.headers["content-security-policy"]).not.toContain(
    "upgrade-insecure-requests",
  );
  expect(dev.headers["cross-origin-opener-policy"]).toBeUndefined();
  const production = createApp(
    fixture.db,
    readConfig({
      DATABASE_URL: "postgresql://test:test@localhost/test",
      NODE_ENV: "production",
      APP_ORIGIN: "https://coffee.example",
    }),
  );
  const prod = await request(production).get("/api/health").expect(200);
  expect(prod.headers["content-security-policy"]).toContain(
    "upgrade-insecure-requests",
  );
  expect(prod.headers["cross-origin-opener-policy"]).toBe("same-origin");
});
