import { expect, test } from "vitest";
import { forecastChart, forecastScore } from "../client/forecast-view.js";
import { metrics } from "../src/shop/forecast-metrics.js";
import type { Forecasts } from "../client/types.js";

test("chart keeps the whole calendar, real zeroes, and unknown dates without joining or zero filling", () => {
  const forecast = {
    date: "2026-11-04",
    product_id: "a",
    product_name: "coffee",
    predicted_qty: 7,
    lower_qty: null,
    upper_qty: null,
    model_version: "mean-7-v1",
    history_source: "actual" as const,
    generated_at: "2026-11-03T00:00:00Z",
  };
  const rows = forecastChart(
    "2026-11-02",
    "2026-11-04",
    [forecast],
    [{ date: "2026-11-02", product_id: "a", qty: 0 }],
  );
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatchObject({ actual: 0, actual_menus: 1 });
  expect(rows[0]!.forecast).toBeUndefined();
  expect(rows[1]).toMatchObject({ date: "2026-11-03", actual_menus: 0 });
  expect(rows[1]!.actual).toBeUndefined();
  expect(rows[1]!.forecast).toBeUndefined();
  expect(rows[2]!.forecast).toBe(7);
  expect(rows[2]!.actual).toBeUndefined();
  expect(rows[2]!.interval).toBeUndefined();
  expect(forecastChart("bad", "2026-11-04", [], [])).toEqual([]);
  expect(forecastChart("2000-01-01", "2099-01-01", [], [])).toEqual([]);
});

function scoreData(): Pick<
  Forecasts,
  "accuracy" | "evaluation" | "displayed_run"
> {
  const genuine = metrics([{ actual: 10, predicted: 10 }]),
    simulation = metrics([{ actual: 4, predicted: 3 }]);
  return {
    accuracy: genuine,
    displayed_run: {
      id: "run",
      generated_at: "2026-11-03T00:00:00Z",
      data_mode: "actual",
      contains_simulated_sales: true,
    },
    evaluation: {
      basis: "fulfilled_v1",
      policy: "earliest-issued-per-target-menu-lead",
      by_product_lead: [],
      latest_test: null,
      by_source: [
        { source: "actual", ...genuine },
        { source: "simulation", ...simulation },
      ],
    },
  };
}
test("simulation run shows its MAPE/RMSE/MAE/WAPE with provenance and never silently uses genuine scores", () => {
  const data = scoreData();
  expect(forecastScore(data, "auto")).toMatchObject({
    source: "simulation",
    metrics: { samples: 1, mae: 1, rmse: 1, mape: 25, wape: 25 },
  });
  expect(forecastScore(data, "actual")).toMatchObject({
    source: "actual",
    metrics: { mae: 0 },
  });
  expect(data.accuracy.mae).toBe(0);
});
test("future run without observations keeps metrics unavailable instead of borrowing another population", () => {
  const data = scoreData();
  data.evaluation.by_source[1] = { source: "simulation", ...metrics([]) };
  expect(forecastScore(data, "auto")).toMatchObject({
    source: "simulation",
    metrics: { samples: 0, mae: null, rmse: null, mape: null, wape: null },
  });
});
