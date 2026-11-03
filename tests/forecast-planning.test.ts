import { expect, test } from "vitest";
import { calculateRequirements } from "../src/shop/forecast-planning.js";
test("menu forecasts convert through recipes and subtract current inventory", () => {
  const result = calculateRequirements(
    [{ product_id: "latte", predicted_qty: 10 }],
    [
      {
        product_id: "latte",
        ingredient_id: "milk",
        name: "Milk",
        unit: "ml",
        qty: 200,
        current_stock: 500,
      },
    ],
  );
  expect(result.ingredients[0]).toMatchObject({
    forecast_requirement: 2000,
    required_qty: 2000,
    shortage: 1500,
    order_qty: 1500,
    status: "shortage",
  });
  expect(
    calculateRequirements(
      [{ product_id: "coffee", predicted_qty: 100 }],
      [
        {
          product_id: "coffee",
          ingredient_id: "beans",
          name: "Beans",
          unit: "g",
          qty: 15,
          current_stock: 1100,
        },
      ],
    ).ingredients[0]?.shortage,
  ).toBe(400);
});
test("safety allowance is configurable and countable ingredients are rounded up", () => {
  const result = calculateRequirements(
    [{ product_id: "a", predicted_qty: 1.1 }],
    [
      {
        product_id: "a",
        ingredient_id: "cup",
        name: "Cups",
        unit: "ชิ้น",
        qty: 1,
        current_stock: 1,
      },
    ],
    1.1,
  );
  expect(result.ingredients[0]).toMatchObject({
    required_qty: 2,
    order_qty: 1,
  });
  expect(() => calculateRequirements([], [], 0.9)).toThrow();
});
test("shared stock shortages affect every dependent menu; missing recipes are explicit", () => {
  const result = calculateRequirements(
    [
      { product_id: "a", predicted_qty: 10 },
      { product_id: "b", predicted_qty: 10 },
      { product_id: "missing", predicted_qty: 2 },
    ],
    ["a", "b"].map((product_id) => ({
      product_id,
      ingredient_id: "milk",
      name: "Milk",
      unit: "ml",
      qty: 200,
      current_stock: 3000,
    })),
  );
  expect(result.ingredients[0]?.required_qty).toBe(4000);
  expect(result.products.map((p) => p.status)).toEqual([
    "shortage",
    "shortage",
    "missing_recipe",
  ]);
});
