import { expect, test } from "vitest";
import { selectDataset, type Observation } from "../src/shop/forecast-data.js";
const rows = (simulated: boolean): Observation[] =>
  Array.from({ length: 35 }, (_, i) => ({
    date: new Date(Date.parse("2026-11-02") - i * 86400000)
      .toISOString()
      .slice(0, 10),
    product_id: "a",
    qty: 12,
    unit_price: 65,
    source: "actual" as const,
    simulated,
    mixed: false,
    is_closed: true,
    kind: "normal",
  })).reverse();
test("training cohorts never blend genuine and generated observations", () => {
  const input = [...rows(true), { ...rows(false).at(-1)!, date: "2026-11-01" }];
  const auto = selectDataset(input, ["a"], "auto", "2026-11-03");
  expect(auto.cohort).toBe("simulation");
  expect(auto.rows).toHaveLength(35);
  expect(
    selectDataset(input, ["a"], "genuine", "2026-11-03").rows,
  ).toHaveLength(1);
});
test("quality exclusions are explicit and never replaced with zero observations", () => {
  const input = rows(false);
  input[0]!.kind = "stockout";
  input[1]!.mixed = true;
  input[2]!.is_closed = false;
  input[3]!.kind = "closed";
  const result = selectDataset(input, ["a"], "genuine", "2026-11-03");
  expect(result.rows).toHaveLength(31);
  expect(result.excluded).toMatchObject({
    flagged: 2,
    mixed_source: 1,
    unclosed: 1,
  });
  expect(result.rows.every((r) => r.qty === 12)).toBe(true);
});
