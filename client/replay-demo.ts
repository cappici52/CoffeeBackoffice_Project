export type DemoLine = { product_id: string; recipe: string; price: number };
export const demoIngredients = [
  { id: "beans", name: "เมล็ดกาแฟ", unit: "g", stock: 1000 },
  { id: "milk", name: "นมสด", unit: "ml", stock: 3000 },
  { id: "water", name: "น้ำ", unit: "ml", stock: 10000 },
  { id: "cocoa", name: "ผงโกโก้", unit: "g", stock: 500 },
  { id: "cups", name: "แก้ว", unit: "ชิ้น", stock: 100 },
];
// Explicit illustrative recipes, never the source shop's recipes.
export const demoRecipes: Record<string, { label: string; price: number; ingredients: Record<string, number> }> = {
  americano: { label: "Americano", price: 55, ingredients: { beans: 18, water: 180, cups: 1 } },
  "americano with milk": { label: "Americano with Milk", price: 60, ingredients: { beans: 18, water: 120, milk: 60, cups: 1 } },
  latte: { label: "Latte", price: 65, ingredients: { beans: 18, milk: 180, cups: 1 } },
  cappuccino: { label: "Cappuccino", price: 65, ingredients: { beans: 18, milk: 150, cups: 1 } },
  espresso: { label: "Espresso", price: 45, ingredients: { beans: 18, water: 40, cups: 1 } },
  cortado: { label: "Cortado", price: 60, ingredients: { beans: 18, milk: 60, cups: 1 } },
  cocoa: { label: "Cocoa", price: 65, ingredients: { cocoa: 20, milk: 180, cups: 1 } },
  "hot chocolate": { label: "Hot Chocolate", price: 65, ingredients: { cocoa: 25, milk: 180, cups: 1 } },
};
export function demoPreparation(
  predictions: { date: string; product_id: string; predicted_qty: number }[],
  from: string, days: number, mapping: DemoLine[], stocks: Record<string, number>,
) {
  const end = Date.parse(from) + days * 86400000;
  const totals = new Map<string, number>();
  for (const p of predictions)
    if (p.date >= from && Date.parse(p.date) < end)
      totals.set(p.product_id, (totals.get(p.product_id) ?? 0) + p.predicted_qty);
  let revenue = 0, mappedUnits = 0;
  const needs: Record<string, number> = {};
  for (const line of mapping) {
    const recipe = demoRecipes[line.recipe];
    if (!recipe) continue;
    const qty = totals.get(line.product_id) ?? 0;
    mappedUnits += qty;
    revenue += qty * line.price;
    for (const [ingredient, amount] of Object.entries(recipe.ingredients))
      needs[ingredient] = (needs[ingredient] ?? 0) + qty * amount;
  }
  return {
    revenue, mappedUnits,
    unmapped: [...totals.keys()].filter(id => !mapping.some(m => m.product_id === id && demoRecipes[m.recipe])),
    ingredients: demoIngredients.filter(i => needs[i.id] !== undefined).map(i => {
      const required = i.unit === "ชิ้น" ? Math.ceil(needs[i.id]!) : needs[i.id]!;
      return { ...i, required, stock: stocks[i.id] ?? 0, shortage: Math.max(0, required - (stocks[i.id] ?? 0)) };
    }),
  };
}
