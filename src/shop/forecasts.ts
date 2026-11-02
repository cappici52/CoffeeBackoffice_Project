import { randomUUID } from "node:crypto";
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
import { refreshSales } from "./reports.js";

const forecastRow = z
  .object({
    date: dateSchema,
    product_id: idSchema,
    predicted_qty: z.number().min(0).max(1e6),
    lower: z.number().min(0).max(1e6),
    upper: z.number().min(0).max(1e6),
    model_version: z.string().min(1).max(100),
  })
  .strict()
  .refine((v) => v.lower <= v.predicted_qty && v.predicted_qty <= v.upper);
export async function history(sql: Sql) {
  return (
    await sql.query(
      `SELECT date::text,product_id,coalesce(sum(qty) FILTER(WHERE source='actual'),sum(qty) FILTER(WHERE source='demo')) AS qty FROM sales_daily WHERE date >= (now() AT TIME ZONE 'Asia/Bangkok')::date - 120 GROUP BY date,product_id ORDER BY date`,
    )
  ).rows;
}
export async function generateForecasts(
  db: Database,
  config: Config,
  from: string,
  to: string,
  actor?: string,
) {
  const range = dateRange.parse({ date_from: from, date_to: to });
  fail(
    (Date.parse(to) - Date.parse(from)) / 86400000 < 30,
    400,
    "FORECAST_RANGE_TOO_LONG",
  );
  await db.transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(7301003)");
    await refreshSales(sql);
  });
  const products = (
    await db.query("SELECT id FROM products WHERE NOT is_archived ORDER BY id")
  ).rows.map((p) => p.id as string);
  fail(
    products.length > 0 && products.length <= 1000,
    409,
    "NO_FORECAST_PRODUCTS",
  );
  let result: unknown;
  try {
    const response = await fetch(`${config.FORECAST_SERVICE_URL}/forecast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...range,
        product_id: null,
        product_ids: products,
        history: (await history(db)).map((h) => ({ ...h, qty: Number(h.qty) })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    fail(response.ok, 502, "FORECAST_SERVICE_UNAVAILABLE");
    result = await response.json();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "FORECAST_SERVICE_UNAVAILABLE"
    )
      throw error;
    fail(false, 502, "FORECAST_SERVICE_UNAVAILABLE");
  }
  const parsed = z.array(forecastRow).max(30000).safeParse(result);
  fail(parsed.success, 502, "FORECAST_INVALID_RESPONSE");
  const rows = parsed.data;
  const expected =
    products.length * ((Date.parse(to) - Date.parse(from)) / 86400000 + 1);
  const keys = new Set(rows.map((r) => `${r.date}:${r.product_id}`));
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
  await db.transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(7301004)");
    for (const row of rows)
      await sql.query(
        "INSERT INTO forecasts (id,forecast_date,product_id,predicted_qty,lower_qty,upper_qty,model_version) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (forecast_date,product_id) DO UPDATE SET predicted_qty=excluded.predicted_qty,lower_qty=excluded.lower_qty,upper_qty=excluded.upper_qty,model_version=excluded.model_version,generated_at=now()",
        [
          randomUUID(),
          row.date,
          row.product_id,
          row.predicted_qty,
          row.lower,
          row.upper,
          row.model_version,
        ],
      );
    if (actor)
      await record(sql, actor, "forecast.generated", "forecast", randomUUID(), {
        from,
        to,
        rows: rows.length,
        model_version: rows[0]?.model_version,
      });
  });
  return {
    count: rows.length,
    model_version: rows[0]?.model_version ?? "unknown",
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
  r.post("/forecasts/generate", async (req, res) => {
    const input = dateRange.parse(req.body);
    fail(input.date_from > businessDate(), 400, "FORECAST_MUST_BE_FUTURE");
    res.json(
      await generateForecasts(
        db,
        config,
        input.date_from,
        input.date_to,
        res.locals.user.id,
      ),
    );
  });
  r.get("/forecasts", async (req, res) => {
    const input = dateRange
      .safeExtend({ product_id: idSchema.optional() })
      .parse(req.query);
    const params = [input.date_from, input.date_to, input.product_id ?? null];
    const points = (
      await db.query(
        "SELECT f.*,f.forecast_date::text AS date,p.name AS product_name FROM forecasts f JOIN products p ON p.id=f.product_id WHERE f.forecast_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR product_id=$3) ORDER BY f.forecast_date,p.name",
        params,
      )
    ).rows;
    const actual = (await history(db)).filter(
      (h) =>
        h.date >= input.date_from &&
        h.date <= input.date_to &&
        (!input.product_id || h.product_id === input.product_id),
    );
    const recommendations = (
      await db.query(
        `SELECT i.id,i.name,i.unit,i.current_stock,sum(f.predicted_qty*ri.qty) AS required_qty,greatest(0,sum(f.predicted_qty*ri.qty)-i.current_stock) AS order_qty FROM forecasts f JOIN recipe_ingredients ri ON ri.product_id=f.product_id JOIN ingredients i ON i.id=ri.ingredient_id WHERE f.forecast_date BETWEEN $1::date AND $2::date AND ($3::uuid IS NULL OR f.product_id=$3) AND i.is_active GROUP BY i.id,i.name,i.unit,i.current_stock ORDER BY order_qty DESC,i.name`,
        params,
      )
    ).rows;
    const sales = await history(db);
    const lookup = new Map(
      sales.map((a) => [`${a.date}:${a.product_id}`, Number(a.qty)]),
    );
    const comparisons = points
      .filter(
        (p) =>
          p.date < businessDate() && lookup.has(`${p.date}:${p.product_id}`),
      )
      .map((p) => ({
        actual: lookup.get(`${p.date}:${p.product_id}`)!,
        predicted: Number(p.predicted_qty),
      }));
    const nonzero = comparisons.filter((p) => p.actual > 0);
    const accuracy = {
      samples: comparisons.length,
      mape: nonzero.length
        ? (nonzero.reduce(
            (s, p) => s + Math.abs((p.actual - p.predicted) / p.actual),
            0,
          ) /
            nonzero.length) *
          100
        : null,
      rmse: comparisons.length
        ? Math.sqrt(
            comparisons.reduce((s, p) => s + (p.actual - p.predicted) ** 2, 0) /
              comparisons.length,
          )
        : null,
    };
    const demo =
      (await db.query("SELECT 1 FROM sales_daily WHERE source='demo' LIMIT 1"))
        .rows.length > 0;
    res.json({
      forecasts: points,
      actual,
      recommendations,
      accuracy,
      contains_demo_history: demo,
      recommendation_basis: "base_recipe",
      model_mode: "mock_until_real_model_connected",
    });
  });
  return r;
}
