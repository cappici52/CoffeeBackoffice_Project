import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "../db.js";
import type { Config } from "../config.js";
import { dateSchema, idSchema, fail } from "./shared.js";
import { requestForecast } from "./forecast-client.js";
import { serializeForecastHistory } from "./forecast-snapshot.js";
import { metrics, intervalMetrics } from "./forecast-metrics.js";
import { replayBaseline, type ReplayBaseline } from "./replay-baseline.js";

export const publicReplayInput = z
  .object({
    dataset_id: idSchema,
    outlet_id: z.string().trim().min(1).max(100),
    product_id: idSchema.optional(),
    cutoff: dateSchema,
    replay_mode: z.enum(["fixed", "rolling"]).default("fixed"),
    reveal_actual: z.boolean().default(true),
    horizon: z.union([z.literal(1), z.literal(7), z.literal(30)]).default(30),
    history_days: z
      .union([z.literal(30), z.literal(90), z.literal(180)])
      .default(180),
  })
  .strict();
type Product = { id: string; name: string; external_id: string };
export type ResearchMetadata = {
  name: string;
  version: string;
  source_url: string;
  license: string;
  license_url: string;
  attribution: string;
  products: Product[];
  outlets: { id: string; date_from: string; date_to: string }[];
  report: Record<string, unknown>;
};
const add = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);

export async function getPublicReplay(db: Database, id: string, revealActual = true) {
  const run = (
    await db.query(
      "SELECT *,cutoff::text AS cutoff FROM research_replay_runs WHERE id=$1",
      [id],
    )
  ).rows[0];
  fail(run, 404, "NOT_FOUND");
  const dataset = (
    await db.query("SELECT metadata FROM research_datasets WHERE id=$1", [
      run.dataset_id,
    ])
  ).rows[0]!.metadata as ResearchMetadata;
  const points = (
    await db.query(
      "SELECT date::text,product_id,prediction FROM research_replay_points WHERE run_id=$1 ORDER BY date,product_id",
      [id],
    )
  ).rows;
  // This held-out query runs only AFTER the immutable predictions have committed.
  const actual = revealActual ? (
    await db.query(
      `SELECT date::text,product_id,qty,quality FROM research_daily_demand
   WHERE dataset_id=$1 AND outlet_id=$2 AND date >= $3::date AND date < $3::date+$4::int AND product_id=ANY($5::uuid[]) ORDER BY date,product_id`,
      [
        run.dataset_id,
        run.outlet_id,
        run.cutoff,
        run.horizon,
        [...new Set(points.map((p) => p.product_id))],
      ],
    )
  ).rows : [];
  const history = run.input_history as { date: string; product_id: string; qty: number }[];
  const baseline: ReplayBaseline[] = run.metadata.benchmark_predictions ??
    (run.metadata.replay_mode === "rolling" ? [] : replayBaseline(history, run.cutoff, run.horizon));
  const baselineLookup = new Map(baseline.map(p => [p.date + ":" + p.product_id, p.predicted_qty]));
  const lookup = new Map(actual.map((r) => [r.date + ":" + r.product_id, r]));
  const rows = points.map((p) => {
    const truth = lookup.get(p.date + ":" + p.product_id),
      prediction = p.prediction;
    return {
      ...prediction,
      product_name:
        dataset.products.find((m) => m.id === p.product_id)?.name ??
        p.product_id,
      actual_qty: truth ? Number(truth.qty) : null,
      actual_quality: truth?.quality ?? "unknown",
      error: truth ? prediction.predicted_qty - Number(truth.qty) : null,
      baseline_qty: baselineLookup.get(p.date + ":" + p.product_id) ?? null,
    };
  });
  const pairs = rows
    .filter((r) => r.actual_qty !== null)
    .map((r) => ({
      actual: r.actual_qty!,
      predicted: r.predicted_qty,
      lower: r.lower,
      upper: r.upper,
    }));
  const perProduct = [...new Set(rows.map((p) => p.product_id))].map(
    (product_id) => ({
      product_id,
      ...metrics(
        rows
          .filter((p) => p.product_id === product_id && p.actual_qty !== null)
          .map((p) => ({ actual: p.actual_qty!, predicted: p.predicted_qty })),
      ),
    }),
  );
  // Shop-total errors answer a different question from product/day accuracy.
  // A partial target day is excluded instead of treating missing menus as zero.
  const dailyPairs = [...new Set(rows.map((p) => p.date))].flatMap((date) => {
    const points = rows.filter((p) => p.date === date);
    return points.every((p) => p.actual_qty !== null)
      ? [
          {
            actual: points.reduce((s, p) => s + p.actual_qty!, 0),
            predicted: points.reduce((s, p) => s + p.predicted_qty, 0),
          },
        ]
      : [];
  });
  return {
    kind: "historical_replay",
    data_mode: "PUBLIC_DATASET",
    run,
    dataset,
    actual_revealed: revealActual,
    history,
    rows,
    score: metrics(pairs),
    aggregate_score: metrics(dailyPairs),
    interval: intervalMetrics(pairs),
    by_product: perProduct,
    benchmark: {
      name: "ยอดวันเดียวกันในสัปดาห์ล่าสุดที่มีข้อมูล",
      score: metrics(rows.filter(r => r.actual_qty !== null && r.baseline_qty !== null)
        .map(r => ({ actual: r.actual_qty!, predicted: r.baseline_qty! }))),
      aggregate_score: metrics([...new Set(rows.map(r => r.date))].flatMap(date => {
        const day = rows.filter(r => r.date === date);
        return day.every(r => r.actual_qty !== null && r.baseline_qty !== null)
          ? [{ actual: day.reduce((s,r) => s + r.actual_qty!, 0), predicted: day.reduce((s,r) => s + r.baseline_qty!, 0) }] : [];
      })),
    },
    coverage: {
      expected: rows.length,
      matched: pairs.length,
      missing: rows.length - pairs.length,
      inferred_zero: actual.filter((r) => r.quality === "inferred_zero").length,
    },
    date_from: run.cutoff,
    date_to: add(run.cutoff, run.horizon - 1),
  };
}

export async function runPublicReplay(
  db: Database,
  config: Config,
  value: unknown,
  actor: string,
) {
  const input = publicReplayInput.parse(value);
  const dataset = (
    await db.query("SELECT metadata FROM research_datasets WHERE id=$1", [
      input.dataset_id,
    ])
  ).rows[0]?.metadata as ResearchMetadata | undefined;
  fail(dataset, 404, "NOT_FOUND");
  const outlet = dataset.outlets.find((o) => o.id === input.outlet_id);
  fail(outlet, 400, "INVALID_REPLAY_OUTLET");
  fail(
    input.cutoff > outlet.date_from &&
      input.cutoff <= outlet.date_to &&
      add(input.cutoff, input.horizon - 1) <= outlet.date_to,
    400,
    "INVALID_REPLAY_CUTOFF",
  );
  // Strict exclusive cutoff: 2025-09-01 sees only dates through 2025-08-31.
  const history = (
    await db.query(
      `SELECT date::text,product_id,qty FROM research_daily_demand
   WHERE dataset_id=$1 AND outlet_id=$2 AND date >= $3::date-$4::int AND date < $3::date
     AND ($5::uuid IS NULL OR product_id=$5) ORDER BY date,product_id`,
      [
        input.dataset_id,
        input.outlet_id,
        input.cutoff,
        input.history_days,
        input.product_id ?? null,
      ],
    )
  ).rows;
  const products = [
    ...new Set(history.map((r) => r.product_id as string)),
  ].sort();
  fail(
    products.length > 0 && products.length <= 1000,
    409,
    "FORECAST_INSUFFICIENT_HISTORY",
  );
  const inputHistory = history.map((r) => ({
    date: r.date as string,
    product_id: r.product_id as string,
    qty: Number(r.qty),
    unit_price: 0,
    source: "actual",
  }));
  const rollingRuns: string[] = [];
  const benchmark: ReplayBaseline[] = [];
  // Each daily forecast commits before its actual is read. Later origins may
  // learn from earlier replay days, never from their own target or later days.
  const rollingForecasts: Awaited<ReturnType<typeof requestForecast>> = [];
  if (input.replay_mode === "rolling") {
    for (let day = 0; day < input.horizon; day++) {
      const child = await runPublicReplay(db, config, {
        ...input, reveal_actual: false, replay_mode: "fixed", cutoff: add(input.cutoff, day), horizon: 1,
      }, actor);
      rollingRuns.push(child.run.id as string);
      benchmark.push(...child.run.metadata.benchmark_predictions);
      const saved = await db.query(
        "SELECT prediction FROM research_replay_points WHERE run_id=$1 ORDER BY date,product_id",
        [child.run.id],
      );
      rollingForecasts.push(...saved.rows.map(r => r.prediction));
    }
  }
  const forecasts = input.replay_mode === "rolling" ? rollingForecasts : await requestForecast(
    config,
    input.cutoff,
    add(input.cutoff, input.horizon - 1),
    products,
    inputHistory,
    "public_dataset",
  );
  const id = randomUUID(),
    snapshot = serializeForecastHistory(inputHistory);
  await db.transaction(async (sql) => {
    await sql.query(
      `INSERT INTO research_replay_runs(id,dataset_id,created_by,cutoff,horizon,outlet_id,product_id,history_sha256,input_history,metadata)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id,
        input.dataset_id,
        actor,
        input.cutoff,
        input.horizon,
        input.outlet_id,
        input.product_id ?? null,
        createHash("sha256").update(snapshot).digest("hex"),
        snapshot,
        JSON.stringify({
          pipeline: "coffee-demand-v5",
          replay_mode: input.replay_mode,
          rolling_run_ids: rollingRuns,
          benchmark_predictions: input.replay_mode === "rolling" ? benchmark : replayBaseline(inputHistory, input.cutoff, input.horizon),
          history_days: input.history_days,
          training_from: inputHistory[0]!.date,
          training_to: inputHistory.at(-1)!.date,
          cutoff_policy: "exclusive_target_start",
          price_policy: "excluded",
          mode: "PUBLIC_DATASET",
          products: products.length,
          excluded_no_history: dataset.products
            .filter(
              (p) =>
                !products.includes(p.id) &&
                (!input.product_id || p.id === input.product_id),
            )
            .map((p) => p.id),
        }),
      ],
    );
    await sql.query(
      `INSERT INTO research_replay_points(run_id,date,product_id,prediction)
   SELECT $1,x.date,x.product_id,x.prediction FROM jsonb_to_recordset($2::jsonb) AS x(date date,product_id uuid,prediction jsonb)`,
      [
        id,
        JSON.stringify(
          forecasts.map((p) => ({
            date: p.date,
            product_id: p.product_id,
            prediction: p,
          })),
        ),
      ],
    );
  });
  return getPublicReplay(db, id, input.reveal_actual);
}
