import { createHash, randomUUID } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Database, Sql } from "../db.js";
import {
  businessDate,
  dateRange,
  dateSchema,
  fail,
  idSchema,
  record,
} from "./shared.js";
import { metrics, intervalMetrics } from "./forecast-metrics.js";
import { serializeForecastHistory } from "./forecast-snapshot.js";
import { dataset, type Cohort } from "./forecast-data.js";
import { requirements } from "./forecast-planning.js";
import { requestForecast } from "./forecast-client.js";
import { runPublicReplay, getPublicReplay } from "./forecast-replay.js";
import { forecastSummary } from "./forecast-summary.js";

export async function history(
  sql: Sql,
  mode: "actual" | "mixed" = "mixed",
  options: { from?: string; to?: string; closedOnly?: boolean } = {},
) {
  return (
    await sql.query(
      `WITH fulfilled AS (
        SELECT (o.completed_at AT TIME ZONE 'Asia/Bangkok')::date AS date,i.product_id,
          sum(i.qty) AS qty,sum(i.qty::bigint*i.unit_price_satang) AS revenue_satang,'actual' AS source
        FROM orders o JOIN order_items i ON i.order_id=o.id
        WHERE o.branch_id=coffee_current_branch() AND o.completed_at IS NOT NULL AND o.status='completed' GROUP BY 1,2
      ), observations AS (
        SELECT date,product_id,qty,revenue_satang,source FROM fulfilled
        WHERE date >= coalesce($2::date,(now() AT TIME ZONE 'Asia/Bangkok')::date - 120)
          AND date <= coalesce($3::date,(now() AT TIME ZONE 'Asia/Bangkok')::date - 1)
          AND date < (now() AT TIME ZONE 'Asia/Bangkok')::date
          AND (NOT $4::boolean OR EXISTS(SELECT 1 FROM day_closings c WHERE c.branch_id=coffee_current_branch() AND c.date=fulfilled.date))
        UNION ALL
        SELECT date,product_id,qty,revenue_satang,source FROM sales_daily
        WHERE branch_id=coffee_current_branch() AND source='demo' AND $1='mixed'
          AND date >= coalesce($2::date,(now() AT TIME ZONE 'Asia/Bangkok')::date - 120)
          AND date <= coalesce($3::date,(now() AT TIME ZONE 'Asia/Bangkok')::date - 1)
          AND date < (now() AT TIME ZONE 'Asia/Bangkok')::date
        UNION ALL
        SELECT c.date,p.id,0,0,'actual' FROM day_closings c CROSS JOIN branch_catalog p
        WHERE c.branch_id=coffee_current_branch() AND c.date >= coalesce($2::date,(now() AT TIME ZONE 'Asia/Bangkok')::date - 120)
          AND c.date <= coalesce($3::date,(now() AT TIME ZONE 'Asia/Bangkok')::date - 1)
          AND c.date < (now() AT TIME ZONE 'Asia/Bangkok')::date
          AND (p.forecast_since <= c.date OR EXISTS (
            SELECT 1 FROM shop_simulation_products sp WHERE sp.run_id=c.simulation_run_id AND sp.product_id=p.id))
          AND NOT EXISTS (SELECT 1 FROM fulfilled s WHERE s.date=c.date AND s.product_id=p.id)
      ), daily AS (
        SELECT date,product_id,
          coalesce(sum(qty) FILTER(WHERE source='actual'),sum(qty) FILTER(WHERE source='demo')) AS qty,
          coalesce(sum(revenue_satang) FILTER(WHERE source='actual'),sum(revenue_satang) FILTER(WHERE source='demo')) AS revenue,
          CASE WHEN bool_or(source='actual') THEN 'actual' ELSE 'demo' END AS source
        FROM observations GROUP BY date,product_id
      ) SELECT d.date::text,d.product_id,p.name AS product_name,d.qty,d.source,
        EXISTS(SELECT 1 FROM day_closings c WHERE c.branch_id=coffee_current_branch() AND c.date=d.date) AS is_closed,
        (EXISTS(SELECT 1 FROM orders o JOIN order_items i ON i.order_id=o.id
          WHERE o.branch_id=coffee_current_branch() AND i.product_id=d.product_id AND (o.completed_at AT TIME ZONE 'Asia/Bangkok')::date=d.date
          AND o.simulation_run_id IS NOT NULL)
          OR EXISTS(SELECT 1 FROM day_closings c WHERE c.branch_id=coffee_current_branch() AND c.date=d.date AND c.simulation_run_id IS NOT NULL)) AS simulated,
        CASE WHEN d.qty>0 THEN d.revenue/d.qty/100.0 ELSE p.price_satang/100.0 END AS unit_price
        FROM daily d JOIN branch_catalog p ON p.id=d.product_id ORDER BY d.date,d.product_id`,
      [
        mode,
        options.from ?? null,
        options.to ?? null,
        options.closedOnly ?? false,
      ],
    )
  ).rows;
}
export async function computeForecast(
  db: Database,
  config: Config,
  from: string,
  to: string,
  products: string[],
  dataMode: "actual" | "mixed",
  cohort: Cohort | "auto",
  methodPolicy: "auto" | "mean28" | "weekly",
  asOf?: string,
  historyDays = 180,
) {
  const range = dateRange.parse({ date_from: from, date_to: to });
  const reference =
    asOf ??
    new Date(Date.parse(businessDate()) - 86400000).toISOString().slice(0, 10);
  const training = await dataset(db, products, cohort, dataMode === "mixed", {
    from: new Date(Date.parse(reference) - (historyDays - 1) * 86400000)
      .toISOString()
      .slice(0, 10),
    to: reference,
    referenceDate: new Date(Date.parse(reference) + 86400000)
      .toISOString()
      .slice(0, 10),
  });
  const inputHistory = training.rows
    .filter((h) => products.includes(h.product_id))
    .map((h) => ({
      date: h.date,
      product_id: h.product_id,
      qty: Number(h.qty),
      unit_price: Number(h.unit_price),
      source: h.source,
    }));
  const rows = await requestForecast(
    config,
    from,
    to,
    products,
    inputHistory,
    training.cohort,
    methodPolicy,
    dataMode === "actual",
  );
  const closedTargets = new Set(
    (
      await db.query(
        "SELECT date::text,product_id FROM forecast_day_quality WHERE kind='closed' AND date BETWEEN $1::date AND $2::date AND ($3::date IS NULL OR updated_at < ($3::date+1)::timestamp AT TIME ZONE 'Asia/Bangkok')",
        [from, to, asOf ?? null],
      )
    ).rows.map((r) => r.date + ":" + r.product_id),
  );
  for (const row of rows)
    if (closedTargets.has(row.date + ":" + row.product_id)) {
      row.predicted_qty = 0;
      row.lower = null;
      row.upper = null;
      row.model_version = "scheduled-closure-v1";
      if (row.diagnostics) {
        row.diagnostics.reason = "scheduled_closure";
        row.diagnostics.interval_kind = "unavailable";
        row.diagnostics.calibration = null;
      }
    }
  return { rows, training, inputHistory };
}

export async function generateForecasts(
  db: Database,
  config: Config,
  from: string,
  to: string,
  actor?: string,
  productId?: string,
  dataMode: "actual" | "mixed" = "actual",
  cohort: Cohort | "auto" = "auto",
  methodPolicy: "auto" | "mean28" | "weekly" = "auto",
) {
  const range = dateRange.parse({ date_from: from, date_to: to });
  fail(
    (Date.parse(to) - Date.parse(from)) / 86400000 < 30,
    400,
    "FORECAST_RANGE_TOO_LONG",
  );
  const generatedAt = new Date();
  fail(
    cohort !== "demo" || dataMode === "mixed",
    400,
    "FORECAST_SOURCE_CONFLICT",
  );
  const products = (
    await db.query(
      "SELECT id FROM branch_catalog WHERE NOT is_archived AND ($1::uuid IS NULL OR id=$1) ORDER BY id",
      [productId ?? null],
    )
  ).rows.map((p) => p.id as string);
  fail(
    products.length > 0 && products.length <= 1000,
    409,
    "NO_FORECAST_PRODUCTS",
  );
  const { rows, training, inputHistory } = await computeForecast(
    db,
    config,
    from,
    to,
    products,
    dataMode,
    cohort,
    methodPolicy,
  );
  const versions = [...new Set(rows.map((r) => r.model_version))].sort();
  const runId = randomUUID();
  const planning = await requirements(
    db,
    rows
      .filter((p) => p.date > businessDate(generatedAt))
      .map((p) => ({
        product_id: p.product_id,
        predicted_qty: p.predicted_qty,
      })),
    config.FORECAST_SAFETY_FACTOR,
  );
  const simulated =
    (
      await db.query(
        `SELECT EXISTS (
    SELECT 1 FROM orders o JOIN order_items i ON i.order_id=o.id
    JOIN jsonb_to_recordset($1::jsonb) AS h(date date,product_id uuid) ON h.product_id=i.product_id
      AND h.date=(o.completed_at AT TIME ZONE 'Asia/Bangkok')::date
    WHERE o.simulation_run_id IS NOT NULL
    UNION ALL
    SELECT 1 FROM day_closings c JOIN shop_simulation_products sp ON sp.run_id=c.simulation_run_id
    JOIN jsonb_to_recordset($1::jsonb) AS h(date date,product_id uuid) ON h.date=c.date AND h.product_id=sp.product_id
  ) AS present`,
        [JSON.stringify(inputHistory)],
      )
    ).rows[0]?.present === true;
  await db.transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(7301004)");
    const snapshot = serializeForecastHistory(inputHistory);
    await sql.query(
      "INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history,created_by,contains_simulated_sales,training_cohort,input_quality,planning_snapshot) VALUES($1,$2,$3,$4,$5,'fulfilled_v1',$6,$7,$8,$9,$10,$11,$12)",
      [
        runId,
        generatedAt.toISOString(),
        from,
        to,
        dataMode,
        createHash("sha256").update(snapshot).digest("hex"),
        snapshot,
        actor ?? null,
        simulated,
        training.cohort,
        JSON.stringify({
          pipeline:
            methodPolicy === "auto"
              ? "coffee-demand-v5"
              : "coffee-demand-v5-" + methodPolicy,
          method_policy: methodPolicy,
          excluded: training.excluded,
          window_days: 180,
        }),
        JSON.stringify(planning),
      ],
    );
    for (const row of rows) {
      const lead =
        (Date.parse(row.date) - Date.parse(businessDate(generatedAt))) /
        86400000;
      await sql.query(
        "INSERT INTO forecast_run_points(run_id,forecast_date,product_id,predicted_qty,model_version,history_source,lead_days,diagnostics,lower_qty,upper_qty) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          runId,
          row.date,
          row.product_id,
          row.predicted_qty,
          row.model_version,
          row.history_source,
          lead,
          JSON.stringify(row.diagnostics ?? {}),
          row.lower,
          row.upper,
        ],
      );
      await sql.query(
        "INSERT INTO forecasts (id,forecast_date,product_id,predicted_qty,lower_qty,upper_qty,model_version,history_source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (branch_id,forecast_date,product_id) DO UPDATE SET predicted_qty=excluded.predicted_qty,lower_qty=excluded.lower_qty,upper_qty=excluded.upper_qty,model_version=excluded.model_version,history_source=excluded.history_source,generated_at=now()",
        [
          randomUUID(),
          row.date,
          row.product_id,
          row.predicted_qty,
          row.lower,
          row.upper,
          row.model_version,
          row.history_source,
        ],
      );
    }
    if (actor)
      await record(sql, actor, "forecast.generated", "forecast", randomUUID(), {
        from,
        to,
        rows: rows.length,
        model_versions: versions,
        run_id: runId,
        data_mode: dataMode,
        target_basis: "fulfilled_v1",
      });
  });
  return {
    run_id: runId,
    count: rows.length,
    model_version:
      versions.length === 1 ? versions[0] : "coffee-demand-v5-mixed",
    model_versions: versions,
  };
}
export function forecastsRouter(
  db: Database,
  config: Config,
  auth: RequestHandler,
  manage: RequestHandler,
) {
  const r = Router();
  r.use("/forecasts", auth, manage);
  r.get("/forecasts/datasets", async (_req, res) => {
    res.json({
      datasets: (
        await db.query(
          "SELECT id,imported_at,data_mode,metadata FROM research_datasets ORDER BY imported_at DESC,id",
        )
      ).rows,
    });
  });
  r.get("/forecasts/replays", async (_req, res) => {
    res.json({
      runs: (
        await db.query(
          "SELECT id,dataset_id,created_at,cutoff::text,horizon,outlet_id,product_id,metadata FROM research_replay_runs ORDER BY created_at DESC,id DESC LIMIT 100",
        )
      ).rows,
    });
  });
  r.get("/forecasts/replays/:id", async (req, res) => {
    const query = z.object({ reveal: z.enum(["true", "false"]).default("true") }).parse(req.query);
    res.json(await getPublicReplay(db, idSchema.parse(req.params.id), query.reveal === "true"));
  });
  r.get("/forecasts/data", async (req, res) => {
    const input = z
      .object({
        product_id: idSchema.optional(),
        data_mode: z.enum(["actual", "mixed"]).default("actual"),
        cohort: z
          .enum(["auto", "genuine", "simulation", "demo"])
          .default("auto"),
      })
      .parse(req.query);
    const products = (
      await db.query(
        "SELECT id,name FROM branch_catalog WHERE NOT is_archived AND ($1::uuid IS NULL OR id=$1) ORDER BY name",
        [input.product_id ?? null],
      )
    ).rows;
    const data = await dataset(
      db,
      products.map((p) => p.id),
      input.cohort,
      input.cohort === "demo" || input.data_mode === "mixed",
    );
    const flags = (
      await db.query(
        "SELECT q.*,q.date::text AS date,p.name AS product_name FROM forecast_day_quality q JOIN branch_catalog p ON p.id=q.product_id WHERE q.date BETWEEN $1::date-180 AND $1::date+30 AND ($2::uuid IS NULL OR q.product_id=$2) ORDER BY q.date DESC,p.name LIMIT 200",
        [businessDate(), input.product_id ?? null],
      )
    ).rows;
    res.json({ ...data, products, flags, window_days: 180 });
  });
  r.put("/forecasts/quality", async (req, res) => {
    const input = z
      .object({
        date: dateSchema,
        product_id: idSchema,
        kind: z.enum([
          "normal",
          "closed",
          "stockout",
          "incomplete",
          "outlier",
          "unknown",
        ]),
        note: z.string().trim().min(1).max(1000),
      })
      .strict()
      .parse(req.body);
    fail(
      input.date <=
        new Date(Date.parse(businessDate()) + 30 * 86400000)
          .toISOString()
          .slice(0, 10),
      400,
      "FUTURE_DATE",
    );
    await db.transaction(async (sql) => {
      fail(
        (
          await sql.query("SELECT id FROM branch_catalog WHERE id=$1", [
            input.product_id,
          ])
        ).rows.length,
        404,
        "NOT_FOUND",
      );
      await sql.query(
        "INSERT INTO forecast_day_quality(date,product_id,kind,note,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(branch_id,date,product_id) DO UPDATE SET kind=excluded.kind,note=excluded.note,updated_by=excluded.updated_by,updated_at=now()",
        [
          input.date,
          input.product_id,
          input.kind,
          input.note,
          res.locals.user.id,
        ],
      );
      await record(
        sql,
        res.locals.user,
        "forecast.quality",
        "product",
        input.product_id,
        input,
      );
    });
    res.json({ saved: true });
  });
  r.post("/forecasts/generate", async (req, res) => {
    if (req.body.horizon !== undefined)
      z.union([z.literal(1), z.literal(7), z.literal(30)]).parse(
        req.body.horizon,
      );
    const input = dateRange
      .safeExtend({
        product_id: idSchema.optional(),
        data_mode: z.enum(["actual", "mixed"]).default("actual"),
        method_policy: z.enum(["auto", "mean28", "weekly"]).default("auto"),
        cohort: z
          .enum(["auto", "genuine", "simulation", "demo"])
          .default("auto"),
      })
      .parse(
        req.body.horizon && !req.body.date_from
          ? {
              ...req.body,
              date_from: new Date(Date.parse(businessDate()) + 86400000)
                .toISOString()
                .slice(0, 10),
              date_to: new Date(
                Date.parse(businessDate()) +
                  Number(req.body.horizon) * 86400000,
              )
                .toISOString()
                .slice(0, 10),
            }
          : req.body,
      );
    fail(input.date_from > businessDate(), 400, "FORECAST_MUST_BE_FUTURE");
    if (req.body.horizon !== undefined)
      fail(
        (Date.parse(input.date_to) - Date.parse(input.date_from)) / 86400000 +
          1 ===
          req.body.horizon,
        400,
        "FORECAST_HORIZON_CONFLICT",
      );
    res.json(
      await generateForecasts(
        db,
        config,
        input.date_from,
        input.date_to,
        res.locals.user.id,
        input.product_id,
        input.data_mode,
        input.cohort,
        input.method_policy,
      ),
    );
  });
  r.post("/forecasts/backtest", async (req, res) => {
    if (req.body.dataset_id !== undefined) {
      res.json(await runPublicReplay(db, config, req.body, res.locals.user.id));
      return;
    }
    const input = z
      .object({
        cutoff: dateSchema,
        horizon: z
          .union([z.literal(1), z.literal(7), z.literal(30)])
          .default(30),
        history_days: z
          .union([z.literal(30), z.literal(90), z.literal(180)])
          .default(180),
        product_id: idSchema.optional(),
        cohort: z
          .enum(["auto", "genuine", "simulation", "demo"])
          .default("auto"),
        data_mode: z.enum(["actual", "mixed"]).default("actual"),
      })
      .strict()
      .parse(req.body);
    fail(input.cutoff < businessDate(), 400, "INVALID_FORECAST_CUTOFF");
    fail(
      input.cohort !== "demo" || input.data_mode === "mixed",
      400,
      "FORECAST_SOURCE_CONFLICT",
    );
    const add = (n: number) =>
      new Date(Date.parse(input.cutoff) + n * 86400000)
        .toISOString()
        .slice(0, 10);
    const products = (
      await db.query(
        "SELECT id FROM branch_catalog WHERE NOT is_archived AND ($1::uuid IS NULL OR id=$1) ORDER BY id",
        [input.product_id ?? null],
      )
    ).rows.map((p) => p.id as string);
    fail(products.length > 0, 409, "NO_FORECAST_PRODUCTS");
    const result = await computeForecast(
      db,
      config,
      add(1),
      add(input.horizon),
      products,
      input.data_mode,
      input.cohort,
      "auto",
      input.cutoff,
      input.history_days,
    );
    const truth = await dataset(
      db,
      products,
      result.training.cohort,
      input.data_mode === "mixed",
      { from: add(1), to: add(input.horizon) },
    );
    const lookup = new Map(
      truth.rows.map((p) => [p.date + ":" + p.product_id, p.qty]),
    );
    const pairs = result.rows
      .filter((p) => lookup.has(p.date + ":" + p.product_id))
      .map((p) => ({
        actual: lookup.get(p.date + ":" + p.product_id)!,
        predicted: p.predicted_qty,
        lower: p.lower,
        upper: p.upper,
      }));
    const analysisId = randomUUID(),
      score = metrics(pairs);
    await record(
      db,
      res.locals.user,
      "forecast.analysis",
      "forecast_analysis",
      analysisId,
      {
        cutoff: input.cutoff,
        horizon: input.horizon,
        history_days: input.history_days,
        cohort: result.training.cohort,
        history_sha256: createHash("sha256")
          .update(serializeForecastHistory(result.inputHistory))
          .digest("hex"),
        score,
      },
    );
    res.json({
      analysis_id: analysisId,
      kind: "backtest",
      cutoff: input.cutoff,
      date_from: add(1),
      date_to: add(input.horizon),
      cohort: result.training.cohort,
      history_days: input.history_days,
      history_observations: result.inputHistory.length,
      forecasts: result.rows.map((p) => ({
        ...p,
        predicted_qty: p.predicted_qty,
        lower_qty: p.lower,
        upper_qty: p.upper,
        product_name: "",
      })),
      actual: truth.rows,
      score,
      interval: intervalMetrics(pairs),
    });
  });
  r.get("/forecasts", async (req, res) => {
    const input = dateRange
      .safeExtend({
        product_id: idSchema.optional(),
        run_id: idSchema.optional(),
        data_mode: z.enum(["actual", "mixed"]).default("actual"),
        lead_days: z.coerce.number().int().min(1).max(30).optional(),
        safety_factor: z.coerce.number().min(1).max(2).optional(),
      })
      .parse(req.query);
    const params = [input.date_from, input.date_to, input.product_id ?? null];
    const runs = (
      await db.query(
        `SELECT r.id,r.generated_at,r.date_from::text,r.date_to::text,r.data_mode,r.target_basis,r.history_sha256,r.contains_simulated_sales,r.training_cohort,r.input_quality,
      (SELECT count(DISTINCT product_id)::int FROM forecast_run_points WHERE run_id=r.id) AS product_count
      FROM forecast_runs r WHERE r.date_from <= $2::date AND r.date_to >= $1::date
      AND ($3::uuid IS NULL OR EXISTS(SELECT 1 FROM forecast_run_points p WHERE p.run_id=r.id AND p.product_id=$3))
      ORDER BY r.generated_at DESC,r.id DESC LIMIT 50`,
        params,
      )
    ).rows;
    // One coherent round: never stitch old demo/cache values into a newer run.
    const widest = Math.max(0, ...runs.map((r) => Number(r.product_count)));
    let displayedRun = input.run_id
      ? runs.find((r) => r.id === input.run_id)
      : runs.find(
          (r) => input.product_id || Number(r.product_count) === widest,
        );
    if (input.run_id && !displayedRun)
      displayedRun = (
        await db.query(
          "SELECT id,generated_at,date_from::text,date_to::text,data_mode,contains_simulated_sales,training_cohort,input_quality FROM forecast_runs WHERE id=$1",
          [input.run_id],
        )
      ).rows[0];
    const displayedRunId = displayedRun?.id ?? null;
    const points = displayedRunId
      ? (
          await db.query(
            `SELECT p.*,p.forecast_date::text AS date,m.name AS product_name,
      r.generated_at
      FROM forecast_run_points p JOIN forecast_runs r ON r.id=p.run_id JOIN branch_catalog m ON m.id=p.product_id
      WHERE p.run_id=$4 AND p.forecast_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR p.product_id=$3)
      ORDER BY p.forecast_date,m.name`,
            [...params, displayedRunId],
          )
        ).rows
      : (
          await db.query(
            `SELECT f.*,f.forecast_date::text AS date,p.name AS product_name,
      (SELECT x.diagnostics FROM forecast_run_points x JOIN forecast_runs r ON r.id=x.run_id
       WHERE x.product_id=f.product_id AND x.forecast_date=f.forecast_date ORDER BY r.generated_at DESC,r.id DESC LIMIT 1) AS diagnostics
      FROM forecasts f JOIN branch_catalog p ON p.id=f.product_id WHERE f.forecast_date BETWEEN $1::date AND $2::date
      AND ($3::uuid IS NULL OR product_id=$3) ORDER BY f.forecast_date,p.name`,
            params,
          )
        ).rows;
    const displayedProducts = new Set(points.map((p) => p.product_id));
    const actual = (
      await history(db, input.data_mode, {
        from: input.date_from,
        to: input.date_to,
      })
    ).filter(
      (h) =>
        h.date >= input.date_from &&
        h.date <= input.date_to &&
        (!input.product_id || h.product_id === input.product_id) &&
        (!displayedRunId ||
          !displayedProducts.size ||
          displayedProducts.has(h.product_id)),
    );
    const planning = await requirements(
      db,
      points
        .filter((p) => p.date > businessDate())
        .map((p) => ({
          product_id: p.product_id,
          predicted_qty: p.predicted_qty,
        })),
      input.safety_factor ?? config.FORECAST_SAFETY_FACTOR,
    );
    const recommendations = planning.ingredients;
    const tomorrow = new Date(Date.parse(businessDate()) + 86400000)
      .toISOString()
      .slice(0, 10);
    const recent = await dataset(
      db,
      [...displayedProducts],
      displayedRun?.training_cohort === "simulation"
        ? "simulation"
        : displayedRun?.training_cohort === "demo"
          ? "demo"
          : "genuine",
      input.data_mode === "mixed",
      {
        from: new Date(Date.parse(businessDate()) - 7 * 86400000)
          .toISOString()
          .slice(0, 10),
        to: businessDate(),
      },
    );
    const summary = forecastSummary(
      tomorrow,
      points.map((p) => ({
        date: p.date,
        product_id: p.product_id,
        qty: p.predicted_qty,
      })),
      recent.rows,
    );
    const sales = await history(db, "actual", {
      from: input.date_from,
      to: input.date_to,
      closedOnly: true,
    });
    const excludedTargets = new Set(
      (
        await db.query(
          "SELECT date::text,product_id FROM forecast_day_quality WHERE kind<>'normal' AND date BETWEEN $1::date AND $2::date",
          params.slice(0, 2),
        )
      ).rows.map((r) => r.date + ":" + r.product_id),
    );
    const lookup = new Map(
      sales
        .filter((a) => !excludedTargets.has(a.date + ":" + a.product_id))
        .map((a) => [`${a.date}:${a.product_id}`, Number(a.qty)]),
    );
    // One fixed, earliest issued forecast per target/menu/lead/source. Repeated
    // generation cannot multiply evaluation samples or cherry-pick a later run.
    const archived = (
      await db.query(
        `WITH ranked AS (
      SELECT p.*,r.generated_at,r.data_mode,r.contains_simulated_sales,r.training_cohort,(r.date_to-r.date_from+1)::int AS horizon,coalesce(p.diagnostics->>'pipeline','legacy') AS pipeline,row_number() OVER(PARTITION BY p.forecast_date,p.product_id,p.lead_days,p.history_source,(r.date_to-r.date_from),CASE WHEN r.training_cohort='legacy' THEN r.data_mode ELSE r.training_cohort END,r.contains_simulated_sales,coalesce(p.diagnostics->>'pipeline','legacy'),r.training_cohort
        ORDER BY r.generated_at,r.id) AS rank
      FROM forecast_run_points p JOIN forecast_runs r ON r.id=p.run_id
      WHERE p.forecast_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR p.product_id=$3)
       AND r.target_basis='fulfilled_v1' AND ($4::int IS NULL OR p.lead_days=$4)
    ) SELECT *,forecast_date::text AS date FROM ranked WHERE rank=1`,
        [...params, input.lead_days ?? null],
      )
    ).rows;
    const snapshots = new Map(
      (
        await db.query(
          "SELECT id,input_history FROM forecast_runs WHERE id=ANY($1::uuid[])",
          [[...new Set(archived.map((p) => p.run_id))]],
        )
      ).rows.map((r) => {
        const rows = r.input_history as {
          date: string;
          product_id: string;
          qty: number;
        }[];
        const menus = new Set(rows.map((h) => h.product_id));
        const dates = new Map<string, Set<string>>();
        for (const h of rows) {
          if (!dates.has(h.date)) dates.set(h.date, new Set());
          dates.get(h.date)!.add(h.product_id);
        }
        const origin = [...dates]
          .filter(([, products]) => products.size === menus.size)
          .map(([date]) => date)
          .sort()
          .at(-1);
        return [
          r.id,
          {
            origin,
            values: new Map(
              rows.map((h) => [h.date + ":" + h.product_id, Number(h.qty)]),
            ),
          },
        ] as const;
      }),
    );
    const evaluatedProducts = [
      ...new Set(archived.map((p) => p.product_id as string)),
    ];
    const [genuineData, simulationData] = evaluatedProducts.length
      ? await Promise.all([
          dataset(db, evaluatedProducts, "genuine", false, {
            from: input.date_from,
            to: input.date_to,
          }),
          dataset(db, evaluatedProducts, "simulation", false, {
            from: input.date_from,
            to: input.date_to,
          }),
        ])
      : [null, null];
    const genuineLookup = new Map(
      genuineData?.rows.map((r) => [r.date + ":" + r.product_id, r.qty]) ?? [],
    );
    const simulationLookup = new Map(
      simulationData?.rows.map((r) => [r.date + ":" + r.product_id, r.qty]) ??
        [],
    );
    const targetLookup = (p: (typeof archived)[number]) =>
      p.training_cohort === "legacy"
        ? lookup
        : p.training_cohort === "simulation"
          ? simulationLookup
          : genuineLookup;
    const allComparisons = archived
      .filter(
        (p) =>
          p.date < businessDate() &&
          businessDate(new Date(p.generated_at)) < p.date &&
          targetLookup(p).has(`${p.date}:${p.product_id}`),
      )
      .map((p) => ({
        actual: targetLookup(p).get(`${p.date}:${p.product_id}`)!,
        predicted: Number(p.predicted_qty),
        product_id: p.product_id,
        lead_days: Number(p.lead_days),
        history_source: p.history_source,
        data_mode: p.data_mode,
        simulated: p.contains_simulated_sales === true,
        source:
          p.training_cohort === "genuine"
            ? "actual"
            : p.training_cohort === "simulation"
              ? "simulation"
              : p.training_cohort === "demo"
                ? "demo"
                : p.contains_simulated_sales
                  ? "simulation"
                  : p.history_source === "actual" && p.data_mode !== "actual"
                    ? "mixed"
                    : p.history_source,
        pipeline: p.pipeline as string,
        model: /^coffee-direct-v[45]-/.test(p.model_version)
          ? p.model_version.match(/^coffee-direct-v[45]/)![0]
          : (p.model_version as string),
        horizon: Number(p.horizon),
        lower:
          p.diagnostics?.interval_kind !== "empirical_absolute_80" ||
          p.lower_qty === null
            ? null
            : Number(p.lower_qty),
        upper:
          p.diagnostics?.interval_kind !== "empirical_absolute_80" ||
          p.upper_qty === null
            ? null
            : Number(p.upper_qty),
        baseline: (() => {
          const snapshot = snapshots.get(p.run_id);
          const origin = p.diagnostics?.origin ?? snapshot?.origin;
          if (!origin || !snapshot) return undefined;
          const delta = (Date.parse(p.date) - Date.parse(origin)) / 86400000;
          if (delta <= 0) return undefined;
          const date = new Date(
            Date.parse(p.date) - Math.ceil(delta / 7) * 7 * 86400000,
          )
            .toISOString()
            .slice(0, 10);
          return snapshot.values.get(date + ":" + p.product_id);
        })(),
      }));
    const evaluationPipeline = displayedRun
      ? (displayedRun.input_quality?.pipeline ?? "legacy")
      : "coffee-demand-v5";
    const comparisons = allComparisons.filter(
      (p) => p.pipeline === evaluationPipeline,
    );
    const pipelineComparison = [
      ...new Set(allComparisons.map((p) => p.pipeline)),
    ].flatMap((pipeline) =>
      ["actual", "simulation", "demo", "mixed"].map((source) => {
        const pairs = allComparisons.filter(
          (p) => p.pipeline === pipeline && p.source === source,
        );
        return {
          pipeline,
          source,
          ...metrics(pairs),
          interval: intervalMetrics(pairs),
        };
      }),
    );
    const genuine = comparisons.filter((p) => p.source === "actual");
    const accuracy = metrics(genuine);
    const bySource = ["actual", "demo", "mixed", "unknown", "simulation"].map(
      (source) => ({
        source,
        ...metrics(comparisons.filter((p) => p.source === source)),
      }),
    );
    const byHorizon = bySource.flatMap(({ source }) =>
      [1, 7, 30].map((horizon) => {
        const pairs = comparisons.filter(
          (p) => p.lead_days <= horizon && p.source === source,
        );
        const paired = pairs.filter((p) => p.baseline !== undefined);
        return {
          source,
          horizon,
          ...metrics(pairs),
          interval: intervalMetrics(pairs),
          paired_model: metrics(paired),
          baseline: metrics(
            paired.map((p) => ({ actual: p.actual, predicted: p.baseline! })),
          ),
        };
      }),
    );
    const byModel = [...new Set(comparisons.map((p) => p.model))].flatMap(
      (model) =>
        ["actual", "simulation", "demo", "mixed"].map((source) => ({
          model,
          source,
          ...metrics(
            comparisons.filter((p) => p.model === model && p.source === source),
          ),
        })),
    );
    const byProduct = [
      ...new Set(comparisons.map((p) => p.product_id)),
    ].flatMap((product_id) =>
      ["actual", "simulation", "demo", "mixed"].map((source) => ({
        product_id,
        source,
        ...metrics(
          comparisons.filter(
            (p) => p.product_id === product_id && p.source === source,
          ),
        ),
      })),
    );
    const byScope = [1, 7, 30].flatMap((horizon) =>
      ["actual", "simulation", "demo", "mixed"].map((source) => ({
        horizon,
        source,
        ...metrics(
          comparisons.filter(
            (p) => p.horizon === horizon && p.source === source,
          ),
        ),
      })),
    );
    const groups = [
      ...new Set(genuine.map((p) => `${p.product_id}:${p.lead_days}`)),
    ].map((key) => {
      const pairs = genuine.filter(
        (p) => `${p.product_id}:${p.lead_days}` === key,
      );
      return {
        product_id: pairs[0]!.product_id,
        lead_days: pairs[0]!.lead_days,
        ...metrics(pairs),
        interval: intervalMetrics(pairs),
      };
    });
    const catalog = (
      await db.query(
        "SELECT id,name FROM branch_catalog WHERE NOT is_archived AND ($1::uuid IS NULL OR id=$1) ORDER BY name",
        [input.product_id ?? null],
      )
    ).rows;
    const availableHistory = await history(db, input.data_mode, {
      closedOnly: true,
    });
    const coverage = catalog.map((product) => {
      const observations = availableHistory.filter(
        (h) => h.product_id === product.id,
      );
      const dates = new Set(observations.map((h) => h.date as string));
      const latest = observations.at(-1)?.date as string | undefined;
      let consecutive = 0;
      for (
        let day = latest;
        day && dates.has(day);
        day = new Date(Date.parse(day) - 86400000).toISOString().slice(0, 10)
      )
        consecutive++;
      const recent = latest
        ? (Date.parse(businessDate()) - Date.parse(latest)) / 86400000 <= 6
        : false;
      return {
        product_id: product.id,
        name: product.name,
        latest_date: latest ?? null,
        consecutive_days: consecutive,
        actual_days: observations.filter((h) => h.source === "actual").length,
        ready: consecutive >= 28 && recent,
      };
    });
    const hasSimulation =
      (
        await db.query(
          "SELECT EXISTS(SELECT 1 FROM orders WHERE simulation_run_id IS NOT NULL) AS present",
        )
      ).rows[0]?.present === true;
    const latestTest =
      (
        await db.query(
          `SELECT r.id,r.date_from::text,r.date_to::text
      FROM shop_simulation_runs s JOIN forecast_runs r ON r.id::text=s.metadata->'report'->>'holdout_run_id'
      WHERE s.status='complete' AND r.date_to < $1::date AND r.date_from >= $1::date-120
      AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM forecast_run_points p WHERE p.run_id=r.id AND p.product_id=$2))
      ORDER BY s.completed_at DESC LIMIT 1`,
          [businessDate(), input.product_id ?? null],
        )
      ).rows[0] ?? null;
    res.json({
      forecasts: points,
      actual,
      recommendations,
      planning,
      summary,
      accuracy,
      evaluation: {
        basis: "fulfilled_v1",
        policy: "earliest-issued-per-target-menu-lead",
        by_source: bySource,
        by_model: byModel,
        by_product: byProduct,
        by_scope: byScope,
        by_horizon: byHorizon,
        by_product_lead: groups,
        latest_test: latestTest,
        pipeline: evaluationPipeline,
        by_pipeline: pipelineComparison,
      },
      runs,
      coverage,
      selected_run_id: displayedRunId,
      displayed_run: displayedRun ?? null,
      target_basis: "fulfilled_v1",
      contains_simulated_sales: hasSimulation,
      contains_demo_history:
        actual.some((h) => h.source === "demo") ||
        points.some((p) => ["demo", "mixed"].includes(p.history_source)),
      recommendation_basis: "base_recipe",
      model_mode: points.length
        ? points.every((p) =>
            /^(projecta-xgb-|coffee-xgb-|coffee-direct-v[45]-|last-value-v1$|scheduled-closure-v1$|ses-v1$|damped-holt-v1$|mean-28-v1$|mean-7-v1$|weekday-mean-v1$|weekly-naive-v1$)/.test(
              p.model_version,
            ),
          )
          ? "adaptive"
          : points.every((p) => p.model_version.startsWith("mock-"))
            ? "mock"
            : "mixed"
        : "empty",
    });
  });
  r.get("/forecasts/runs/:id", async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const run = (
      await db.query("SELECT * FROM forecast_runs WHERE id=$1", [id])
    ).rows[0];
    fail(run, 404, "NOT_FOUND");
    const points = (
      await db.query(
        "SELECT *,forecast_date::text AS date FROM forecast_run_points WHERE run_id=$1 ORDER BY forecast_date,product_id",
        [id],
      )
    ).rows;
    res.json({
      format: "coffee-forecast-run-v1",
      run,
      points,
      checksum_encoding: "sha256-of-input_history_serialized-utf8",
      input_history_serialized: serializeForecastHistory(run.input_history),
    });
  });
  return r;
}
