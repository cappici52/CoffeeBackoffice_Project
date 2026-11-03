import { createHash, randomUUID } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Database, Sql } from "../db.js";
import { ApiError } from "../security.js";
import {
  businessDate,
  dateRange,
  dateSchema,
  fail,
  idSchema,
  record,
} from "./shared.js";
import { metrics } from "./forecast-metrics.js";
import { serializeForecastHistory } from "./forecast-snapshot.js";
import { dataset } from "./forecast-data.js";

const forecastRow = z
  .object({
    date: dateSchema,
    product_id: idSchema,
    predicted_qty: z.number().min(0).max(1e6),
    lower: z.number().min(0).max(1e6).nullable(),
    upper: z.number().min(0).max(1e6).nullable(),
    model_version: z.string().min(1).max(100),
    history_source: z
      .enum(["actual", "demo", "mixed", "unknown"])
      .default("unknown"),
    diagnostics: z
      .object({
        origin: dateSchema,
        history_days: z.number().int().min(28).max(120),
        reason: z.string().max(200),
        horizon: z
          .union([z.literal(1), z.literal(7), z.literal(30)])
          .optional(),
        validation_origins: z.number().int().min(0).max(30).optional(),
        gap_days: z.number().int().min(0).max(6).optional(),
        selection: z.record(
          z.string().max(100),
          z.object({
            mae: z.number().nonnegative(),
            rmse: z.number().nonnegative(),
            wape: z.number().nonnegative().nullable(),
            samples: z.number().int().nonnegative(),
          }),
        ),
      })
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.lower === null && v.upper === null) ||
      (v.lower !== null &&
        v.upper !== null &&
        v.lower <= v.predicted_qty &&
        v.predicted_qty <= v.upper),
  );
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
        WHERE o.completed_at IS NOT NULL GROUP BY 1,2
      ), observations AS (
        SELECT date,product_id,qty,revenue_satang,source FROM fulfilled
        WHERE date >= coalesce($2::date,(now() AT TIME ZONE 'Asia/Bangkok')::date - 120)
          AND date <= coalesce($3::date,(now() AT TIME ZONE 'Asia/Bangkok')::date - 1)
          AND date < (now() AT TIME ZONE 'Asia/Bangkok')::date
          AND (NOT $4::boolean OR EXISTS(SELECT 1 FROM day_closings c WHERE c.date=fulfilled.date))
        UNION ALL
        SELECT date,product_id,qty,revenue_satang,source FROM sales_daily
        WHERE source='demo' AND $1='mixed'
          AND date >= coalesce($2::date,(now() AT TIME ZONE 'Asia/Bangkok')::date - 120)
          AND date <= coalesce($3::date,(now() AT TIME ZONE 'Asia/Bangkok')::date - 1)
          AND date < (now() AT TIME ZONE 'Asia/Bangkok')::date
        UNION ALL
        SELECT c.date,p.id,0,0,'actual' FROM day_closings c CROSS JOIN products p
        WHERE c.date >= coalesce($2::date,(now() AT TIME ZONE 'Asia/Bangkok')::date - 120)
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
        EXISTS(SELECT 1 FROM day_closings c WHERE c.date=d.date) AS is_closed,
        (EXISTS(SELECT 1 FROM orders o JOIN order_items i ON i.order_id=o.id
          WHERE i.product_id=d.product_id AND (o.completed_at AT TIME ZONE 'Asia/Bangkok')::date=d.date
          AND o.simulation_run_id IS NOT NULL)
          OR EXISTS(SELECT 1 FROM day_closings c WHERE c.date=d.date AND c.simulation_run_id IS NOT NULL)) AS simulated,
        CASE WHEN d.qty>0 THEN d.revenue/d.qty/100.0 ELSE p.price_satang/100.0 END AS unit_price
        FROM daily d JOIN products p ON p.id=d.product_id ORDER BY d.date,d.product_id`,
      [
        mode,
        options.from ?? null,
        options.to ?? null,
        options.closedOnly ?? false,
      ],
    )
  ).rows;
}
export async function generateForecasts(
  db: Database,
  config: Config,
  from: string,
  to: string,
  actor?: string,
  productId?: string,
  dataMode: "actual" | "mixed" = "actual",
) {
  const range = dateRange.parse({ date_from: from, date_to: to });
  fail(
    (Date.parse(to) - Date.parse(from)) / 86400000 < 30,
    400,
    "FORECAST_RANGE_TOO_LONG",
  );
  const generatedAt = new Date();
  const products = (
    await db.query(
      "SELECT id FROM products WHERE NOT is_archived AND ($1::uuid IS NULL OR id=$1) ORDER BY id",
      [productId ?? null],
    )
  ).rows.map((p) => p.id as string);
  fail(
    products.length > 0 && products.length <= 1000,
    409,
    "NO_FORECAST_PRODUCTS",
  );
  const inputHistory = (await history(db, dataMode, { closedOnly: true }))
    .filter((h) => products.includes(h.product_id))
    .map((h) => ({
      date: h.date,
      product_id: h.product_id,
      qty: Number(h.qty),
      unit_price: Number(h.unit_price),
      source: h.source,
    }));
  let result: unknown;
  try {
    const response = await fetch(`${config.FORECAST_SERVICE_URL}/forecast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...range,
        product_id: null,
        product_ids: products,
        history: inputHistory,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 422) {
      const error = (await response.json().catch(() => null)) as {
        detail?: { code?: string };
      } | null;
      if (error?.detail?.code === "FORECAST_INSUFFICIENT_HISTORY")
        throw new ApiError(409, "FORECAST_INSUFFICIENT_HISTORY");
    }
    fail(response.ok, 502, "FORECAST_SERVICE_UNAVAILABLE");
    result = await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(false, 502, "FORECAST_SERVICE_UNAVAILABLE");
  }
  const parsed = z.array(forecastRow).max(30000).safeParse(result);
  fail(parsed.success, 502, "FORECAST_INVALID_RESPONSE");
  const rows = parsed.data;
  const expected =
    products.length * ((Date.parse(to) - Date.parse(from)) / 86400000 + 1);
  const keys = new Set(rows.map((r) => `${r.date}:${r.product_id}`));
  const versions = [...new Set(rows.map((r) => r.model_version))].sort();
  fail(
    rows.length === expected &&
      keys.size === expected &&
      rows.every(
        (r) =>
          r.date >= from && r.date <= to && products.includes(r.product_id),
      ),
    502,
    "FORECAST_INVALID_RESPONSE",
  );
  fail(
    dataMode !== "actual" || rows.every((r) => r.history_source === "actual"),
    502,
    "FORECAST_INVALID_RESPONSE",
  );
  const runId = randomUUID();
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
      "INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history,created_by,contains_simulated_sales) VALUES($1,$2,$3,$4,$5,'fulfilled_v1',$6,$7,$8,$9)",
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
        "INSERT INTO forecasts (id,forecast_date,product_id,predicted_qty,lower_qty,upper_qty,model_version,history_source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (forecast_date,product_id) DO UPDATE SET predicted_qty=excluded.predicted_qty,lower_qty=excluded.lower_qty,upper_qty=excluded.upper_qty,model_version=excluded.model_version,history_source=excluded.history_source,generated_at=now()",
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
      versions.length === 1 ? versions[0] : "coffee-selection-v1-mixed",
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
  r.get("/forecasts/data", async (req, res) => {
    const input = z
      .object({
        product_id: idSchema.optional(),
        cohort: z
          .enum(["auto", "genuine", "simulation", "demo"])
          .default("auto"),
      })
      .parse(req.query);
    const products = (
      await db.query(
        "SELECT id,name FROM products WHERE NOT is_archived AND ($1::uuid IS NULL OR id=$1) ORDER BY name",
        [input.product_id ?? null],
      )
    ).rows;
    const data = await dataset(
      db,
      products.map((p) => p.id),
      input.cohort,
      input.cohort === "demo",
    );
    const flags = (
      await db.query(
        "SELECT q.*,q.date::text AS date,p.name AS product_name FROM forecast_day_quality q JOIN products p ON p.id=q.product_id WHERE q.date BETWEEN $1::date-180 AND $1::date+30 AND ($2::uuid IS NULL OR q.product_id=$2) ORDER BY q.date DESC,p.name LIMIT 200",
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
        kind: z.enum(["normal", "closed", "stockout", "incomplete"]),
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
          await sql.query("SELECT id FROM products WHERE id=$1", [
            input.product_id,
          ])
        ).rows.length,
        404,
        "NOT_FOUND",
      );
      await sql.query(
        "INSERT INTO forecast_day_quality(date,product_id,kind,note,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(date,product_id) DO UPDATE SET kind=excluded.kind,note=excluded.note,updated_by=excluded.updated_by,updated_at=now()",
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
    const input = dateRange
      .safeExtend({
        product_id: idSchema.optional(),
        data_mode: z.enum(["actual", "mixed"]).default("actual"),
      })
      .parse(req.body);
    fail(input.date_from > businessDate(), 400, "FORECAST_MUST_BE_FUTURE");
    res.json(
      await generateForecasts(
        db,
        config,
        input.date_from,
        input.date_to,
        res.locals.user.id,
        input.product_id,
        input.data_mode,
      ),
    );
  });
  r.get("/forecasts", async (req, res) => {
    const input = dateRange
      .safeExtend({
        product_id: idSchema.optional(),
        run_id: idSchema.optional(),
        data_mode: z.enum(["actual", "mixed"]).default("actual"),
        lead_days: z.coerce.number().int().min(1).max(30).optional(),
      })
      .parse(req.query);
    const params = [input.date_from, input.date_to, input.product_id ?? null];
    const runs = (
      await db.query(
        `SELECT r.id,r.generated_at,r.date_from::text,r.date_to::text,r.data_mode,r.target_basis,r.history_sha256,r.contains_simulated_sales,
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
          "SELECT id,generated_at,date_from::text,date_to::text,data_mode,contains_simulated_sales FROM forecast_runs WHERE id=$1",
          [input.run_id],
        )
      ).rows[0];
    const displayedRunId = displayedRun?.id ?? null;
    const points = displayedRunId
      ? (
          await db.query(
            `SELECT p.*,p.forecast_date::text AS date,m.name AS product_name,
      r.generated_at
      FROM forecast_run_points p JOIN forecast_runs r ON r.id=p.run_id JOIN products m ON m.id=p.product_id
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
      FROM forecasts f JOIN products p ON p.id=f.product_id WHERE f.forecast_date BETWEEN $1::date AND $2::date
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
    const recommendations = (
      await db.query(
        `WITH selected AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(product_id uuid,predicted_qty numeric))
      SELECT i.id,i.name,i.unit,i.current_stock,sum(f.predicted_qty*ri.qty) AS required_qty,
      greatest(0,sum(f.predicted_qty*ri.qty)-i.current_stock) AS order_qty FROM selected f
      JOIN recipe_ingredients ri ON ri.product_id=f.product_id JOIN ingredients i ON i.id=ri.ingredient_id
      WHERE i.is_active GROUP BY i.id,i.name,i.unit,i.current_stock ORDER BY order_qty DESC,i.name`,
        [
          JSON.stringify(
            points
              .filter((p) => p.date > businessDate())
              .map((p) => ({
                product_id: p.product_id,
                predicted_qty: Number(p.predicted_qty),
              })),
          ),
        ],
      )
    ).rows;
    const sales = await history(db, "actual", {
      from: input.date_from,
      to: input.date_to,
      closedOnly: true,
    });
    const lookup = new Map(
      sales.map((a) => [`${a.date}:${a.product_id}`, Number(a.qty)]),
    );
    // One fixed, earliest issued forecast per target/menu/lead/source. Repeated
    // generation cannot multiply evaluation samples or cherry-pick a later run.
    const archived = (
      await db.query(
        `WITH ranked AS (
      SELECT p.*,r.generated_at,r.data_mode,r.contains_simulated_sales,row_number() OVER(PARTITION BY p.forecast_date,p.product_id,p.lead_days,p.history_source,r.data_mode,r.contains_simulated_sales
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
    const comparisons = archived
      .filter(
        (p) =>
          p.date < businessDate() &&
          businessDate(new Date(p.generated_at)) < p.date &&
          lookup.has(`${p.date}:${p.product_id}`),
      )
      .map((p) => ({
        actual: lookup.get(`${p.date}:${p.product_id}`)!,
        predicted: Number(p.predicted_qty),
        product_id: p.product_id,
        lead_days: Number(p.lead_days),
        history_source: p.history_source,
        data_mode: p.data_mode,
        simulated: p.contains_simulated_sales === true,
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
    const genuine = comparisons.filter(
      (p) =>
        p.history_source === "actual" &&
        p.data_mode === "actual" &&
        !p.simulated,
    );
    const accuracy = metrics(genuine);
    const bySource = ["actual", "demo", "mixed", "unknown", "simulation"].map(
      (source) => ({
        source,
        ...metrics(
          comparisons.filter(
            (p) =>
              (p.simulated
                ? "simulation"
                : p.history_source === "actual" && p.data_mode !== "actual"
                  ? "mixed"
                  : p.history_source) === source,
          ),
        ),
      }),
    );
    const byHorizon = bySource.flatMap(({ source }) =>
      [1, 7, 30].map((horizon) => {
        const pairs = comparisons.filter(
          (p) =>
            p.lead_days <= horizon &&
            (p.simulated
              ? "simulation"
              : p.history_source === "actual" && p.data_mode !== "actual"
                ? "mixed"
                : p.history_source) === source,
        );
        const paired = pairs.filter((p) => p.baseline !== undefined);
        return {
          source,
          horizon,
          ...metrics(pairs),
          paired_model: metrics(paired),
          baseline: metrics(
            paired.map((p) => ({ actual: p.actual, predicted: p.baseline! })),
          ),
        };
      }),
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
      };
    });
    const catalog = (
      await db.query(
        "SELECT id,name FROM products WHERE NOT is_archived AND ($1::uuid IS NULL OR id=$1) ORDER BY name",
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
      accuracy,
      evaluation: {
        basis: "fulfilled_v1",
        policy: "earliest-issued-per-target-menu-lead",
        by_source: bySource,
        by_horizon: byHorizon,
        by_product_lead: groups,
        latest_test: latestTest,
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
            /^(projecta-xgb-|coffee-xgb-|ses-v1$|damped-holt-v1$|mean-28-v1$|mean-7-v1$|weekday-mean-v1$|weekly-naive-v1$)/.test(
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
