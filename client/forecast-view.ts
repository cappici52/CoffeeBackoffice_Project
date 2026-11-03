import type { Forecasts, ForecastMetrics } from "./types.js";

export function forecastChart(
  from: string,
  to: string,
  forecasts: Forecasts["forecasts"],
  actual: Forecasts["actual"],
) {
  const rows = new Map<
    string,
    {
      date: string;
      actual?: number;
      actual_menus: number;
      forecast?: number;
      lower: number;
      upper: number;
      hasInterval?: boolean;
      interval?: [number, number];
    }
  >();
  if (
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(to)) ||
    Date.parse(to) < Date.parse(from) ||
    Date.parse(to) - Date.parse(from) > 366 * 86400000
  )
    return [];
  for (let time = Date.parse(from); time <= Date.parse(to); time += 86400000) {
    const date = new Date(time).toISOString().slice(0, 10);
    rows.set(date, { date, actual_menus: 0, lower: 0, upper: 0 });
  }
  for (const f of forecasts) {
    const row = rows.get(f.date);
    if (!row) continue;
    row.forecast = (row.forecast ?? 0) + Number(f.predicted_qty);
    row.hasInterval =
      (row.hasInterval ?? true) && f.lower_qty !== null && f.upper_qty !== null;
    if (f.lower_qty !== null && f.upper_qty !== null) {
      row.lower += Number(f.lower_qty);
      row.upper += Number(f.upper_qty);
    }
  }
  for (const a of actual) {
    const row = rows.get(a.date);
    if (row) {
      row.actual = (row.actual ?? 0) + Number(a.qty);
      row.actual_menus++;
    }
  }
  return [...rows.values()].map((row) => ({
    ...row,
    ...(row.forecast !== undefined && row.hasInterval
      ? { interval: [row.lower, row.upper] as [number, number] }
      : {}),
  }));
}

export function forecastScore(
  data: Pick<Forecasts, "accuracy" | "evaluation" | "displayed_run">,
  requested: string,
) {
  const groups = data.evaluation.by_source;
  const find = (source: string): ForecastMetrics =>
    source === "actual"
      ? data.accuracy
      : (groups.find((g) => g.source === source) ?? {
          samples: 0,
          mae: null,
          rmse: null,
          mape: null,
          wape: null,
          bias: null,
          zero_actual_samples: 0,
        });
  const allowed = ["actual", "simulation", "demo", "mixed", "unknown"];
  let source = allowed.includes(requested) ? requested : "actual";
  if (!allowed.includes(requested)) {
    if (data.displayed_run?.contains_simulated_sales) source = "simulation";
    else if (data.displayed_run?.data_mode === "mixed")
      source =
        [...groups]
          .filter((g) => g.source !== "actual" && g.samples > 0)
          .sort((a, b) => b.samples - a.samples)[0]?.source ?? "mixed";
    else if (!data.accuracy.samples)
      source =
        [...groups].sort((a, b) => b.samples - a.samples)[0]?.source ??
        "actual";
  }
  return { source, metrics: find(source) };
}
