import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createApp } from "../dist/app.js";
import { connectDatabase } from "../dist/db.js";
import { readConfig } from "../dist/config.js";
import { hashPassword } from "../dist/security.js";
import { sandboxUrl } from "./simulation-plan.mjs";
import { stopSimulationService } from "./simulation-process.mjs";

if (process.env.NODE_ENV === "production")
  throw new Error("Synthetic preview disabled in production");
const latest = JSON.parse(
  await readFile(".local/simulation/latest.json", "utf8"),
);
assert.equal(latest.synthetic, true);
const url = sandboxUrl(process.env.DATABASE_URL, latest.database);
const output = resolve(".local/simulation", latest.database);
const report = JSON.parse(
  await readFile(resolve(output, "report.json"), "utf8"),
);
assert.equal(report.synthetic, true);
assert.equal(report.database, latest.database);
const db = connectDatabase(url);
let child, server;
async function checkPort(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
}
async function stop() {
  if (server) await new Promise((resolve) => server.close(resolve));
  stopSimulationService(child);
  await db.close();
}
try {
  const marker = (await db.query("SELECT kind FROM simulation_metadata")).rows;
  assert.equal(marker.length, 1);
  assert.equal(marker[0].kind, "synthetic-only");
  await checkPort(3002);
  await checkPort(18002);
  // Replay is complete. Manual preview uses normal wall time in this sandbox only.
  await db.query(
    "CREATE OR REPLACE FUNCTION public.now() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT pg_catalog.now()'",
  );
  const accessPath = resolve(output, "review-access.json");
  let access;
  if (existsSync(accessPath))
    access = JSON.parse(await readFile(accessPath, "utf8"));
  else {
    access = {
      synthetic: true,
      url: "http://localhost:3002",
      email: "owner@simulation.invalid",
      password: randomBytes(24).toString("base64url"),
    };
    await writeFile(accessPath, JSON.stringify(access, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  }
  assert.equal(access.synthetic, true);
  assert.equal(access.email, "owner@simulation.invalid");
  await db.query(
    "UPDATE users SET name='ข้อมูลจำลอง · เจ้าของร้าน',password_hash=$1 WHERE email=$2 AND role='owner'",
    [await hashPassword(access.password), access.email],
  );
  const python = resolve(
    process.platform === "win32"
      ? ".venv/Scripts/python.exe"
      : ".venv/bin/python",
  );
  child = spawn(
    process.env.SIMULATION_PYTHON ?? (existsSync(python) ? python : "python"),
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
      stdio: "ignore",
      windowsHide: true,
    },
  );
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (spawnError || child.exitCode !== null)
      throw new Error("Synthetic forecast service could not start");
    try {
      if ((await fetch("http://127.0.0.1:18002/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(ready, "Synthetic forecast service not ready");
  const app = createApp(
    db,
    readConfig({
      NODE_ENV: "test",
      DATABASE_URL: url,
      APP_ORIGIN: "http://localhost:3002",
      FORECAST_SERVICE_URL: "http://127.0.0.1:18002",
    }),
  );
  server = app.listen(3002, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", resolve);
  });
  console.log("SYNTHETIC SALES ONLY — http://localhost:3002/forecast");
  console.log(
    "Private review login saved in " +
      accessPath +
      " (not printed, not committed).",
  );
  console.log(
    "Live shop database and forecast runtime are separate. Ctrl+C stops this preview.",
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await stop();
      process.exit(0);
    });
} catch (error) {
  await stop();
  throw error;
}
