import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { testDatabase } from "./database.js";
import { migrate } from "../src/migrate.js";
import { seedOwner } from "../src/seed.js";
import { readConfig } from "../src/config.js";
import { runForecastSchedule } from "../src/forecast-scheduler.js";
import { businessDate } from "../src/shop/shared.js";
import type { generateForecasts } from "../src/shop/forecasts.js";
const config = readConfig({
  DATABASE_URL: "postgresql://test:test@localhost/test",
});
const day = businessDate(),
  previous = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10),
  at = new Date(day + "T03:00:00+07:00");
test("scheduler requires yesterday closing and generates 1/7/30 exactly once", async () => {
  const f = await testDatabase();
  try {
    await migrate(f.db);
    await seedOwner(f.db, "owner@example.com", "Coffee-owner-password1");
    const owner = (await f.db.query("SELECT id FROM users")).rows[0]!.id;
    let calls = 0;
    const generate: typeof generateForecasts = async (
      db,
      _config,
      from,
      to,
    ) => {
      calls++;
      const id = randomUUID();
      await db.transaction(async (sql) => {
        await sql.query(
          "INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history) VALUES($1,now(),$2,$3,'actual','fulfilled_v1',$4,'[]')",
          [id, from, to, "a".repeat(64)],
        );
      });
      return {
        run_id: id,
        count: 1,
        model_version: "test",
        model_versions: ["test"],
      };
    };
    expect(
      (
        await runForecastSchedule(
          f.db,
          config,
          new Date(day + "T01:00:00+07:00"),
          generate,
        )
      ).status,
    ).toBe("before_schedule");
    expect((await runForecastSchedule(f.db, config, at, generate)).status).toBe(
      "waiting_for_close",
    );
    expect(calls).toBe(0);
    await f.db.query(
      "INSERT INTO day_closings(date,closed_by,summary) VALUES($1,$2,'{}')",
      [previous, owner],
    );
    expect(
      (await runForecastSchedule(f.db, config, at, generate)).generated,
    ).toEqual([1, 7, 30]);
    expect((await runForecastSchedule(f.db, config, at, generate)).status).toBe(
      "already_complete",
    );
    expect(calls).toBe(3);
    expect(
      (await f.db.query("SELECT horizon,run_id FROM forecast_jobs")).rows,
    ).toHaveLength(3);
  } finally {
    await f.close();
  }
}, 30000);
test("a failed scheduled batch rolls back runs and jobs together", async () => {
  const f = await testDatabase();
  try {
    await migrate(f.db);
    await seedOwner(f.db, "owner@example.com", "Coffee-owner-password1");
    const owner = (await f.db.query("SELECT id FROM users")).rows[0]!.id;
    await f.db.query(
      "INSERT INTO day_closings(date,closed_by,summary) VALUES($1,$2,'{}')",
      [previous, owner],
    );
    let calls = 0;
    const generate: typeof generateForecasts = async (
      db,
      _config,
      from,
      to,
    ) => {
      if (++calls === 2) throw new Error("temporary model failure");
      const id = randomUUID();
      await db.query(
        "INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history) VALUES($1,now(),$2,$3,'actual','fulfilled_v1',$4,'[]')",
        [id, from, to, "b".repeat(64)],
      );
      return {
        run_id: id,
        count: 1,
        model_version: "test",
        model_versions: ["test"],
      };
    };
    await expect(
      runForecastSchedule(f.db, config, at, generate),
    ).rejects.toThrow("temporary model failure");
    expect(
      (await f.db.query("SELECT id FROM forecast_runs")).rows,
    ).toHaveLength(0);
    expect(
      (await f.db.query("SELECT run_date FROM forecast_jobs")).rows,
    ).toHaveLength(0);
  } finally {
    await f.close();
  }
}, 30000);
