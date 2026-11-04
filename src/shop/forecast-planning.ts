import type { Sql } from "../db.js";
type Forecast = { product_id: string; predicted_qty: number | string };
type RecipeLine = {
  product_id: string;
  ingredient_id: string;
  name: string;
  unit: string;
  qty: number | string;
  current_stock: number | string;
};
const rounded = (value: number) => Math.round(value * 1000) / 1000;
const discrete = (unit: string) => ["ชิ้น", "ถุง", "ขวด"].includes(unit);

export function calculateRequirements(
  forecasts: Forecast[],
  recipes: RecipeLine[],
  safetyFactor = 1,
) {
  if (!Number.isFinite(safetyFactor) || safetyFactor < 1 || safetyFactor > 2)
    throw new Error("Invalid safety factor");
  const quantities = new Map<string, number>();
  for (const f of forecasts)
    quantities.set(
      f.product_id,
      (quantities.get(f.product_id) ?? 0) + Number(f.predicted_qty),
    );
  const totals = new Map<
    string,
    {
      id: string;
      name: string;
      unit: string;
      current_stock: number;
      forecast_requirement: number;
    }
  >();
  for (const line of recipes) {
    const qty = quantities.get(line.product_id);
    if (qty === undefined) continue;
    const total = totals.get(line.ingredient_id) ?? {
      id: line.ingredient_id,
      name: line.name,
      unit: line.unit,
      current_stock: Number(line.current_stock),
      forecast_requirement: 0,
    };
    total.forecast_requirement += qty * Number(line.qty);
    totals.set(line.ingredient_id, total);
  }
  const ingredients = [...totals.values()]
    .map((i) => {
      const raw = rounded(i.forecast_requirement * safetyFactor),
        required = discrete(i.unit) ? Math.ceil(raw) : raw;
      const shortage = rounded(Math.max(0, required - i.current_stock));
      return {
        ...i,
        forecast_requirement: rounded(i.forecast_requirement),
        required_qty: required,
        shortage,
        order_qty: discrete(i.unit) ? Math.ceil(shortage) : shortage,
        status: shortage > 0 ? "shortage" : "sufficient",
      };
    })
    .sort((a, b) => b.order_qty - a.order_qty || a.name.localeCompare(b.name));
  const shortages = new Set(
    ingredients.filter((i) => i.shortage > 0).map((i) => i.id),
  );
  const products = [...quantities].map(([product_id, predicted_qty]) => {
    const lines = recipes.filter((r) => r.product_id === product_id);
    return {
      product_id,
      predicted_qty,
      status: !lines.length
        ? "missing_recipe"
        : lines.some((r) => shortages.has(r.ingredient_id))
          ? "shortage"
          : "sufficient",
    };
  });
  return { safety_factor: safetyFactor, ingredients, products };
}

export async function requirements(
  db: Sql,
  forecasts: Forecast[],
  factor: number,
) {
  const ids = [...new Set(forecasts.map((p) => p.product_id))];
  const recipes = ids.length
    ? (
        await db.query<RecipeLine>(
          "SELECT ri.product_id,ri.ingredient_id,i.name,i.unit,ri.qty,i.current_stock FROM recipe_ingredients ri JOIN stock_ingredients i ON i.id=ri.ingredient_id WHERE ri.product_id=ANY($1::uuid[]) AND i.is_active",
          [ids],
        )
      ).rows
    : [];
  return calculateRequirements(forecasts, recipes, factor);
}
