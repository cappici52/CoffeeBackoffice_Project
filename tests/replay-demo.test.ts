import { expect, test } from "vitest";
import { replayBaseline } from "../src/shop/replay-baseline.js";
import { demoPreparation } from "../client/replay-demo.js";

test("frozen weekday benchmark ignores target values, preserves zero and never recursively uses predictions", () => {
  const h = [
    { date: "2025-01-06", product_id: "a", qty: 0 },
    { date: "2025-01-07", product_id: "a", qty: 20 },
    { date: "2025-01-13", product_id: "a", qty: 999 },
  ];
  const b = replayBaseline(h, "2025-01-13", 8);
  expect(b[0]!.predicted_qty).toBe(0);
  expect(b[1]!.predicted_qty).toBe(20);
  expect(b[2]!.predicted_qty).toBe(10);
  expect(b[7]!.predicted_qty).toBe(0);
});

test("illustrative preparation uses only selected forecast dates, exposes unmapped menus, rounds cups, and clamps shortage", () => {
  const rows = [
    { date: "2025-02-01", product_id: "a", predicted_qty: 2.5 },
    { date: "2025-02-02", product_id: "a", predicted_qty: 50 },
    { date: "2025-02-01", product_id: "b", predicted_qty: 10 },
  ];
  const mapping = [{ product_id: "a", recipe: "latte", price: 65 }];
  const plan = demoPreparation(rows, "2025-02-01", 1, mapping, { milk: 100, cups: 10 });
  expect(plan.revenue).toBe(162.5);
  expect(plan.unmapped).toEqual(["b"]);
  expect(plan.ingredients.find(i => i.id === "milk")).toMatchObject({ required: 450, shortage: 350 });
  expect(plan.ingredients.find(i => i.id === "cups")).toMatchObject({ required: 3, shortage: 0 });
  expect(rows[0]!.predicted_qty).toBe(2.5);
});
