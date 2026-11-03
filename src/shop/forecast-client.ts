import { z } from "zod";
import type { Config } from "../config.js";
import { ApiError } from "../security.js";
import { dateSchema, idSchema, fail } from "./shared.js";
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
        history_days: z.number().int().min(1).max(180),
        reason: z.string().max(200),
        horizon: z
          .union([z.literal(1), z.literal(7), z.literal(30)])
          .optional(),
        validation_origins: z.number().int().min(0).max(30).optional(),
        gap_days: z.number().int().min(0).max(6).optional(),
        pipeline: z.string().max(100).optional(),
        method_policy: z.enum(["auto", "mean28", "weekly"]).optional(),
        training_cohort: z
          .enum(["genuine", "simulation", "demo", "public_dataset"])
          .optional(),
        interval_kind: z
          .enum(["empirical_absolute_80", "unavailable"])
          .optional(),
        calibration: z
          .object({
            samples: z.number().int().min(20).max(30),
            date_from: dateSchema,
            date_to: dateSchema,
          })
          .nullable()
          .optional(),
        selection: z.record(
          z.string().max(100),
          z.object({
            mae: z.number().nonnegative(),
            rmse: z.number().nonnegative(),
            wape: z.number().nonnegative().nullable(),
            bias: z.number().finite().optional(),
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
export async function requestForecast(
  config: Config,
  from: string,
  to: string,
  products: string[],
  inputHistory: {
    date: string;
    product_id: string;
    qty: number;
    unit_price: number;
    source: string;
  }[],
  cohort: "genuine" | "simulation" | "demo" | "public_dataset",
  methodPolicy: "auto" | "mean28" | "weekly" = "auto",
  actualOnly = cohort !== "demo",
) {
  const range = { date_from: from, date_to: to };
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
        pipeline: "v5",
        cohort,
        method_policy: methodPolicy,
      }),
      signal: AbortSignal.timeout(
        cohort === "public_dataset" ? 180_000 : 60_000,
      ),
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
  const expectedPipeline =
    methodPolicy === "auto"
      ? "coffee-demand-v5"
      : "coffee-demand-v5-" + methodPolicy;
  fail(
    rows.every(
      (row) =>
        row.diagnostics?.pipeline === expectedPipeline &&
        (!row.diagnostics.training_cohort ||
          row.diagnostics.training_cohort === cohort),
    ),
    502,
    "FORECAST_INVALID_RESPONSE",
  );
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
  fail(
    !actualOnly || rows.every((r) => r.history_source === "actual"),
    502,
    "FORECAST_INVALID_RESPONSE",
  );
  return rows;
}
