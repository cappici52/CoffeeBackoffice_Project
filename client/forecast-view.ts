import type { Forecasts, ForecastMetrics } from "./types.js";

export function forecastChart(
  from: string,
  to: string,
  forecasts: Forecasts["forecasts"],
  actual: Forecasts["actual"],
  expectedMenus = 0,
) {
  const rows = new Map<
    string,
    {
      date: string;
      actual?: number;
      partialActual?: number;
      unclosed?: boolean;
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
      row.unclosed ||= a.is_closed === false;
    }
  }
  return [...rows.values()].map((row) => ({
    ...row,
    ...(row.actual !== undefined &&
    (row.unclosed || row.actual_menus < expectedMenus)
      ? { partialActual: row.actual, actual: undefined }
      : {}),
    ...(row.forecast !== undefined && row.hasInterval
      ? { interval: [row.lower, row.upper] as [number, number] }
      : {}),
  }));
}

export function monthRange(month: string, offset = 0) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid month");
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year!, number! - 1 + offset, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  );
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

// Quote every cell and neutralize spreadsheet formulas in user-controlled names.
export function forecastCsv(from: string, to: string, data: Forecasts) {
  const cell = (value: unknown) => {
    let text = value == null ? "" : String(value);
    if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const products = new Map(
    data.actual.map((a) => [a.product_id, a.product_name ?? a.product_id]),
  );
  for (const f of data.forecasts) products.set(f.product_id, f.product_name);
  const observed = new Map(
    data.actual.map((a) => [a.date + ":" + a.product_id, a]),
  );
  const predicted = new Map(
    data.forecasts.map((f) => [f.date + ":" + f.product_id, f]),
  );
  const rows: unknown[][] = [
    [
      "date",
      "product_id",
      "product_name",
      "actual_qty",
      "day_status",
      "actual_source",
      "predicted_qty",
      "model_version",
      "forecast_run_id",
      "forecast_contains_simulation",
      "lower_qty",
      "upper_qty",
      "pipeline",
      "training_cohort",
      "interval_kind",
    ],
  ];
  for (const day of forecastChart(from, to, [], []))
    for (const [id, name] of products) {
      const a = observed.get(day.date + ":" + id),
        f = predicted.get(day.date + ":" + id);
      rows.push([
        day.date,
        id,
        name,
        a?.qty,
        a ? (a.is_closed ? "closed" : "unclosed") : "unknown",
        a ? (a.simulated ? "simulation" : (a.source ?? "unknown")) : "unknown",
        f?.predicted_qty,
        f?.model_version,
        f ? data.selected_run_id : "",
        f ? data.displayed_run?.contains_simulated_sales : "",
        f?.lower_qty,
        f?.upper_qty,
        f?.diagnostics?.pipeline,
        f ? data.displayed_run?.training_cohort : "",
        f?.diagnostics?.interval_kind,
      ]);
    }
  return (
    "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n"
  );
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
    if (data.displayed_run?.training_cohort === "genuine") source = "actual";
    else if (data.displayed_run?.training_cohort === "demo") source = "demo";
    else if (
      data.displayed_run?.contains_simulated_sales ||
      data.displayed_run?.training_cohort === "simulation"
    )
      source = "simulation";
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
