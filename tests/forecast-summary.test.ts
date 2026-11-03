import { expect, test } from "vitest";
import { forecastSummary } from "../src/shop/forecast-summary.js";
test("summary requires seven complete days and excludes today and other menus", () => {
  const history = Array.from({ length: 7 }, (_, i) => ({
    date: "2026-10-" + String(24 + i),
    product_id: "latte",
    qty: 10,
  }));
  const forecast = [{ date: "2026-11-01", product_id: "latte", qty: 12 }];
  expect(
    forecastSummary("2026-11-01", forecast, [
      ...history,
      { date: "2026-10-31", product_id: "latte", qty: 999 },
    ]),
  ).toEqual({ tomorrow: 12, seven_day_average: 10, change_percent: 20 });
  expect(
    forecastSummary("2026-11-01", forecast, history.slice(1)).seven_day_average,
  ).toBeNull();
  expect(
    forecastSummary(
      "2026-11-01",
      [...forecast, { date: "2026-11-02", product_id: "tea", qty: 3 }],
      history,
    ).tomorrow,
  ).toBeNull();
});
