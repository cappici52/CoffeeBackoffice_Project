import type { Sql } from "../db.js";
import { businessDate } from "./shared.js";

export type Cohort = "genuine" | "simulation" | "demo";
export type Observation = {
  date: string;
  product_id: string;
  qty: number;
  unit_price: number;
  source: "actual" | "demo";
  simulated: boolean;
  mixed: boolean;
  is_closed: boolean;
  kind: string;
};

// The ledger remains unchanged. Exclusions and source choices form a reproducible input snapshot.
export function selectDataset(
  rows: Observation[],
  products: string[],
  requested: Cohort | "auto",
  today: string,
) {
  const usable = rows.filter(
    (r) =>
      r.kind === "normal" && !r.mixed && (r.source === "demo" || r.is_closed),
  );
  const group = (cohort: Cohort) =>
    usable.filter((r) =>
      cohort === "demo"
        ? r.source === "demo"
        : r.source === "actual" && r.simulated === (cohort === "simulation"),
    );
  const productReady = (cohort: Cohort, id: string, minimum = 28) => {
    const values = group(cohort)
      .filter((r) => r.product_id === id)
      .sort((a, b) => a.date.localeCompare(b.date));
    const recent = values.filter(
      (r) => Date.parse(r.date) >= Date.parse(today) - 56 * 86400000,
    );
    return (
      recent.length >= minimum &&
      !!values.at(-1) &&
      Date.parse(today) - Date.parse(values.at(-1)!.date) <= 6 * 86400000
    );
  };
  const ready = (cohort: Cohort) =>
    products.every((id) => productReady(cohort, id));
  const cohort =
    requested === "auto"
      ? ready("genuine")
        ? "genuine"
        : ready("simulation")
          ? "simulation"
          : ready("demo")
            ? "demo"
            : products.every((id) => productReady("genuine", id, 1))
              ? "genuine"
              : products.every((id) => productReady("simulation", id, 1))
                ? "simulation"
                : products.every((id) => productReady("demo", id, 1))
                  ? "demo"
                  : "genuine"
      : requested;
  const selected = group(cohort).filter((r) => products.includes(r.product_id));
  return {
    cohort,
    rows: selected,
    readiness: products.map((id) => {
      const values = selected.filter((r) => r.product_id === id);
      return {
        product_id: id,
        observations: values.length,
        latest_date: values.at(-1)?.date ?? null,
        ready: productReady(cohort, id, 1),
        model_ready: productReady(cohort, id),
        limited_history: !productReady(cohort, id),
      };
    }),
    excluded: {
      unclosed: rows.filter((r) => !r.is_closed && r.source === "actual")
        .length,
      mixed_source: rows.filter((r) => r.mixed).length,
      flagged: rows.filter((r) => r.kind !== "normal").length,
      other_cohort: usable.length - selected.length,
    },
  };
}

export async function dataset(
  sql: Sql,
  products: string[],
  requested: Cohort | "auto",
  allowDemo = false,
  range?: { from: string; to: string; referenceDate?: string },
) {
  const today = businessDate();
  const result = await sql.query(
    `WITH delivered AS (
    SELECT (o.completed_at AT TIME ZONE 'Asia/Bangkok')::date AS date,i.product_id,
      sum(i.qty) AS qty,sum(i.qty::bigint*i.unit_price_satang) AS revenue,
      bool_or(o.simulation_run_id IS NOT NULL) AS simulated,
      bool_or(o.simulation_run_id IS NOT NULL) AND bool_or(o.simulation_run_id IS NULL) AS mixed
    FROM orders o JOIN order_items i ON i.order_id=o.id
    WHERE o.completed_at >= $4::date::timestamp AT TIME ZONE 'Asia/Bangkok'
      AND o.status='completed'
      AND o.completed_at < (least($5::date,$1::date-1)+1)::timestamp AT TIME ZONE 'Asia/Bangkok'
      AND i.product_id=ANY($2::uuid[]) GROUP BY 1,2
  ), observed AS (
    SELECT d.date,d.product_id,d.qty,d.revenue,'actual' AS source,d.simulated,d.mixed,c.date IS NOT NULL AS is_closed
    FROM delivered d LEFT JOIN day_closings c ON c.date=d.date
    UNION ALL
    SELECT c.date,p.id,0,0,'actual',c.simulation_run_id IS NOT NULL,false,true
    FROM day_closings c CROSS JOIN products p
    WHERE p.id=ANY($2::uuid[]) AND c.date BETWEEN $4::date AND least($5::date,$1::date-1)
      AND (p.forecast_since<=c.date OR EXISTS(SELECT 1 FROM shop_simulation_products sp WHERE sp.run_id=c.simulation_run_id AND sp.product_id=p.id))
      AND NOT EXISTS(SELECT 1 FROM delivered d WHERE d.date=c.date AND d.product_id=p.id)
    UNION ALL
    SELECT date,product_id,qty,revenue_satang,'demo',false,false,true FROM sales_daily
    WHERE source='demo' AND $3::boolean AND product_id=ANY($2::uuid[]) AND date BETWEEN $4::date AND least($5::date,$1::date-1)
  ) SELECT o.date::text,o.product_id,o.qty,o.source,o.simulated,o.mixed,o.is_closed,
      CASE WHEN o.qty>0 THEN o.revenue/o.qty/100.0 ELSE p.price_satang/100.0 END AS unit_price,
      coalesce(q.kind,'normal') AS kind
    FROM observed o JOIN products p ON p.id=o.product_id LEFT JOIN forecast_day_quality q ON q.date=o.date AND q.product_id=o.product_id
    ORDER BY o.date,o.product_id`,
    [
      today,
      products,
      allowDemo,
      range?.from ??
        new Date(Date.parse(today) - 180 * 86400000).toISOString().slice(0, 10),
      range?.to ?? today,
    ],
  );
  return selectDataset(
    result.rows.map((r) => ({
      ...r,
      qty: Number(r.qty),
      unit_price: Number(r.unit_price),
    })) as Observation[],
    products,
    requested,
    range?.referenceDate ?? today,
  );
}
