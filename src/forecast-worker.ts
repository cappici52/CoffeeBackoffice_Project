import { readConfig } from "./config.js";
import { connectDatabase } from "./db.js";
import { runForecastSchedule } from "./forecast-scheduler.js";

const config = readConfig();
const db = connectDatabase(config.DATABASE_URL);
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const result = await runForecastSchedule(db, config);
    if (result.generated.length)
      console.log("Nightly forecasts completed", result.generated.join(","));
  } catch (error) {
    console.error(
      "Forecast job failed; will retry next minute",
      error instanceof Error ? error.message : "Unknown error",
    );
  } finally {
    running = false;
  }
}
const timer = setInterval(() => void tick(), 60_000);
void tick();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    void db.close().then(() => process.exit(0));
  });
