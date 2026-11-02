import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "../db.js";
import { ApiError, type User } from "../security.js";
export const idSchema = z.uuid();
export const text = z.string().trim().min(1).max(120);
export const note = z.string().trim().max(1000);
export const quantity = z
  .number()
  .finite()
  .positive()
  .max(1_000_000)
  .refine(
    (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 0.000001,
    "Use at most 3 decimal places",
  );
export const money = z.number().int().min(0).max(10_000_000);
export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});
export const imageUrl = z.union([
  z.literal(""),
  z
    .url()
    .refine((u) => new URL(u).protocol === "https:", "Use an HTTPS image URL"),
]);
export function fail(
  condition: unknown,
  status: number,
  code: string,
): asserts condition {
  if (!condition) throw new ApiError(status, code);
}
export async function record(
  sql: Sql,
  actor: User | string,
  action: string,
  entity: string,
  id: string,
  details: object = {},
) {
  await sql.query(
    "INSERT INTO audit_logs (actor_id,action,entity_type,entity_id,details) VALUES ($1,$2,$3,$4,$5)",
    [
      typeof actor === "string" ? actor : actor.id,
      action,
      entity,
      id,
      JSON.stringify(details),
    ],
  );
}
export async function moveStock(
  sql: Sql,
  actor: User | string,
  ingredientId: string,
  type: string,
  qty: number,
  reason: string,
  orderId: string | null = null,
) {
  const r = await sql.query(
    "UPDATE ingredients SET current_stock = current_stock + $1, version=version+1 WHERE id=$2 AND current_stock + $1 >= 0 RETURNING current_stock",
    [qty, ingredientId],
  );
  fail(r.rows[0], 409, "INSUFFICIENT_STOCK");
  await sql.query(
    "INSERT INTO stock_movements (id,ingredient_id,type,qty,balance_after,reason,ref_order_id,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      randomUUID(),
      ingredientId,
      type,
      qty,
      r.rows[0].current_stock,
      reason,
      orderId,
      typeof actor === "string" ? actor : actor.id,
    ],
  );
}
export const roundQty = (n: number) => Math.round(n * 1000) / 1000;
export function businessDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export const dateSchema = z.iso.date();
export const dateRange = z
  .object({ date_from: dateSchema, date_to: dateSchema })
  .refine(
    (v) =>
      v.date_from <= v.date_to &&
      (Date.parse(v.date_to) - Date.parse(v.date_from)) / 86400000 <= 366,
    "Use a date range of at most 367 days",
  );
