import "dotenv/config";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

if (!existsSync("dist/client/index.html"))
  throw new Error("Run npm run build first");
if (!process.env.DATABASE_URL)
  throw new Error("Configure DATABASE_URL in .env first");
const port = Number(process.env.PORT ?? 3001);
const python = resolve(
  process.platform === "win32"
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python",
);
const forecast = new URL(
  process.env.FORECAST_SERVICE_URL ?? "http://127.0.0.1:8001",
);
const localForecast = ["127.0.0.1", "localhost"].includes(forecast.hostname);
if (localForecast && !existsSync(python))
  throw new Error(
    "Create .venv and install forecast-service/requirements.txt first",
  );
try {
  if (
    (
      await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1500),
      })
    ).ok
  )
    throw new Error(`Coffee Backoffice is already running on port ${port}`);
} catch (error) {
  if (error.message?.includes("already running")) throw error;
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill();
  process.exitCode = code;
}
function start(executable, args) {
  const child = spawn(executable, args, { stdio: "inherit", env: process.env });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
  return child;
}
if (localForecast)
  start(python, [
    "-m",
    "uvicorn",
    "app:app",
    "--app-dir",
    "forecast-service",
    "--host",
    forecast.hostname,
    "--port",
    forecast.port || "8001",
  ]);
start(process.execPath, ["dist/server.js"]);
let healthy = false;
for (let attempt = 0; attempt < 40 && !stopping; attempt++) {
  try {
    if (
      (
        await fetch(forecast.origin + "/health", {
          signal: AbortSignal.timeout(1000),
        })
      ).ok
    ) {
      healthy = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!healthy) {
  console.error("Forecast service did not start");
  stop(1);
} else {
  start(process.execPath, ["dist/forecast-worker.js"]);
  console.log(`Open http://localhost:${port} — Ctrl+C stops local services`);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
