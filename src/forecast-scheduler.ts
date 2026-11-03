import type { Database } from "./db.js";
import type { Config } from "./config.js";
import { businessDate } from "./shop/shared.js";
import { generateForecasts } from "./shop/forecasts.js";
const add = (day: string, n: number) =>
  new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
export async function runForecastSchedule(
  db: Database,
  config: Config,
  at = new Date(),
  generate = generateForecasts,
) {
  const date = businessDate(at),
    hour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Bangkok",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(at),
    );
  if (hour < 2) return { status: "before_schedule", generated: [] as number[] };
  return db.transaction(async (sql) => {
    if (
      !(
        await sql.query("SELECT pg_try_advisory_xact_lock(7301005) AS acquired")
      ).rows[0]?.acquired
    )
      return { status: "locked", generated: [] as number[] };
    if (
      (
        await sql.query(
          "SELECT EXISTS(SELECT 1 FROM shop_simulation_runs WHERE status='running' OR (status='failed' AND coalesce(metadata->>'rolled_back','false')<>'true')) AS active",
        )
      ).rows[0]?.active
    )
      return { status: "replay_active", generated: [] as number[] };
    if (
      !(
        await sql.query("SELECT date FROM day_closings WHERE date=$1", [
          add(date, -1),
        ])
      ).rows.length
    )
      return { status: "waiting_for_close", generated: [] as number[] };
    const generated: number[] = [];
    const atomic: Database = {
      query: (text, values) => sql.query(text, values),
      transaction: (work) => work(sql),
    };
    for (const horizon of [1, 7, 30]) {
      if (
        (
          await sql.query(
            "SELECT run_date FROM forecast_jobs WHERE run_date=$1 AND horizon=$2",
            [date, horizon],
          )
        ).rows.length
      )
        continue;
      const result = await generate(
        atomic,
        config,
        add(date, 1),
        add(date, horizon),
      );
      await sql.query(
        "INSERT INTO forecast_jobs(run_date,horizon,model_version,run_id) VALUES($1,$2,$3,$4)",
        [date, horizon, result.model_version, result.run_id],
      );
      generated.push(horizon);
    }
    return {
      status: generated.length ? "generated" : "already_complete",
      generated,
    };
  });
}
