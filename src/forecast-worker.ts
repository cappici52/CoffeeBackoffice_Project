import { readConfig } from "./config.js";
import { connectDatabase } from "./db.js";
import { businessDate } from "./shop/shared.js";
import { generateForecasts } from "./shop/forecasts.js";

const config = readConfig();
const db = connectDatabase(config.DATABASE_URL);
let running = false;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + n * 86400000)
    .toISOString()
    .slice(0, 10);
async function tick() {
  if (running) return;
  running = true;
  try {
    const date = businessDate();
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date()),
    );
    if (hour < 2) return;
    // Keep a dedicated transaction advisory lock across the service call so only one worker runs.
    await db.transaction(async (sql) => {
      const lock = (
        await sql.query("SELECT pg_try_advisory_xact_lock(7301005) AS acquired")
      ).rows[0]?.acquired;
      if (!lock) return;
      if (
        (
          await sql.query(
            "SELECT run_date FROM forecast_jobs WHERE run_date=$1",
            [date],
          )
        ).rows.length
      )
        return;
      const result = await generateForecasts(
        db,
        config,
        addDays(date, 1),
        addDays(date, 7),
      );
      await sql.query(
        "INSERT INTO forecast_jobs (run_date,model_version) VALUES ($1,$2)",
        [date, result.model_version],
      );
      console.log("Nightly forecast completed", date);
    });
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
