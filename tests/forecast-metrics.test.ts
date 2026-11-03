import { expect, test } from "vitest";
import { metrics } from "../src/shop/forecast-metrics.js";

test("zero sales count toward MAE/RMSE but do not invent WAPE or MAPE", () => {
  expect(metrics([{ actual: 0, predicted: 2 }])).toEqual({
    samples: 1,
    mae: 2,
    rmse: 2,
    wape: null,
    mape: null,
    bias: 2,
    zero_actual_samples: 1,
  });
});
test("empty forecasts have no accuracy score", () => {
  expect(metrics([])).toMatchObject({
    samples: 0,
    mae: null,
    rmse: null,
    wape: null,
    mape: null,
    bias: null,
  });
});
test("metrics retain bias direction and MAPE denominator excludes zero targets", () => {
  expect(
    metrics([
      { actual: 0, predicted: 2 },
      { actual: 4, predicted: 2 },
    ]),
  ).toMatchObject({
    samples: 2,
    mae: 2,
    rmse: 2,
    wape: 100,
    mape: 50,
    bias: 0,
    zero_actual_samples: 1,
  });
});

test("interval coverage is measured only for issued ranges with observations", async () => {
  const { intervalMetrics } = await import("../src/shop/forecast-metrics.js");
  expect(
    intervalMetrics([
      { actual: 4, lower: 2, upper: 5 },
      { actual: 9, lower: 2, upper: 5 },
      { actual: 1, lower: null, upper: null },
    ]),
  ).toEqual({ samples: 2, nominal: 80, coverage: 50, mean_width: 3 });
  expect(intervalMetrics([])).toMatchObject({
    samples: 0,
    coverage: null,
    mean_width: null,
  });
});
