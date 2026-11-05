import { randomUUID } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Database, Sql } from "../db.js";
import {
  businessDate,
  dateRange,
  dateSchema,
  fail,
  note,
  pagination,
  record,
} from "./shared.js";

export async function refreshSales(sql: Sql) {
  await sql.query("DELETE FROM sales_daily WHERE source='actual'");
  await sql.query(`INSERT INTO sales_daily (date,product_id,qty,revenue_satang,source)
 SELECT (p.paid_at AT TIME ZONE 'Asia/Bangkok')::date,i.product_id,sum(i.qty),sum(i.qty::bigint*i.unit_price_satang),'actual'
 FROM payments p JOIN order_items i ON i.order_id=p.order_id WHERE p.status='paid'
 GROUP BY (p.paid_at AT TIME ZONE 'Asia/Bangkok')::date,i.product_id`);
}
export async function salesSummary(
  sql: Sql,
  from: string,
  to: string,
  includeProfit: boolean,
) {
  const params = [from, to];
  const filter =
    "p.status='paid' AND (p.paid_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date";
  const summary = (
    await sql.query(
      `SELECT count(*)::int AS orders,coalesce(sum(amount_satang),0)::bigint AS revenue_satang,coalesce(sum(amount_satang) FILTER(WHERE method='cash'),0)::bigint AS cash_satang,coalesce(sum(amount_satang) FILTER(WHERE method='promptpay'),0)::bigint AS promptpay_satang FROM payments p WHERE ${filter}`,
      params,
    )
  ).rows[0];
  const refunds = (
    await sql.query(
      "SELECT count(*)::int AS count,coalesce(sum(amount_satang),0)::bigint AS amount_satang FROM payments WHERE status='refunded' AND (refunded_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date",
      params,
    )
  ).rows[0];
  const daily = (
    await sql.query(
      `SELECT (p.paid_at AT TIME ZONE 'Asia/Bangkok')::date::text AS date,count(*)::int AS orders,sum(amount_satang)::bigint AS revenue_satang FROM payments p WHERE ${filter} GROUP BY 1 ORDER BY 1`,
      params,
    )
  ).rows;
  const products = (
    await sql.query(
      `SELECT i.product_id,i.product_name,sum(i.qty)::int AS qty,sum(i.qty::bigint*i.unit_price_satang)::bigint AS revenue_satang,avg(extract(epoch from (i.completed_at-i.started_at))) FILTER(WHERE i.started_at IS NOT NULL AND i.completed_at IS NOT NULL) AS avg_prep_seconds ${includeProfit ? ",sum(i.qty*i.unit_cost_satang) AS cost_satang" : ""} FROM payments p JOIN order_items i ON i.order_id=p.order_id WHERE ${filter} GROUP BY i.product_id,i.product_name ORDER BY sum(i.qty) DESC,i.product_name`,
      params,
    )
  ).rows;
  const hourly = (
    await sql.query(
      `SELECT extract(hour from p.paid_at AT TIME ZONE 'Asia/Bangkok')::int AS hour,count(*)::int AS orders,sum(amount_satang)::bigint AS revenue_satang FROM payments p WHERE ${filter} GROUP BY 1 ORDER BY 1`,
      params,
    )
  ).rows;
  const closings = (
    await sql.query(
      "SELECT c.date::text,c.closed_at,c.note,u.name AS closed_by_name FROM day_closings c JOIN users u ON u.id=c.closed_by WHERE c.date BETWEEN $1::date AND $2::date ORDER BY c.date DESC",
      params,
    )
  ).rows;
  return {
    summary,
    refunds,
    daily,
    products: products.map((p) =>
      includeProfit
        ? {
            ...p,
            profit_satang: Number(p.revenue_satang) - Number(p.cost_satang),
          }
        : p,
    ),
    hourly,
    closings,
    timezone: "Asia/Bangkok",
  };
}
export function reportsRouter(
  db: Database,
  auth: RequestHandler,
  manage: RequestHandler,
  owner: RequestHandler,
) {
  const r = Router();
  r.use(["/reports", "/audit-logs"], auth);
  r.get("/reports", manage, async (req, res) => {
    const input = dateRange.parse(req.query);
    res.json(await salesSummary(
        db,
        input.date_from,
        input.date_to,
        res.locals.user.role === "owner",
      ));
  });
  r.post("/reports/close", manage, async (req, res) => {
    const input = z
      .object({ date: dateSchema, note: note.default("") })
      .strict()
      .parse(req.body);
    fail(input.date <= businessDate(), 400, "FUTURE_DATE");
    await db.transaction(async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(7301003)");
      fail(
        !(
          await sql.query("SELECT date FROM day_closings WHERE date=$1", [
            input.date,
          ])
        ).rows.length,
        409,
        "DAY_ALREADY_CLOSED",
      );
      const open = await sql.query(
        "SELECT o.id FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE (o.status IN ('pending','preparing','ready') OR (o.status='completed' AND p.order_id IS NULL)) AND (o.created_at AT TIME ZONE 'Asia/Bangkok')::date <= $1::date LIMIT 1",
        [input.date],
      );
      fail(!open.rows.length, 409, "OPEN_ORDERS_EXIST");
      const report = await salesSummary(sql, input.date, input.date, false);
      await sql.query(
        "INSERT INTO day_closings (date,closed_by,summary,note) VALUES ($1,$2,$3,$4)",
        [
          input.date,
          res.locals.user.id,
          JSON.stringify(report.summary),
          input.note,
        ],
      );
      await refreshSales(sql);
      await record(
        sql,
        res.locals.user,
        "day.closed",
        "closing",
        randomUUID(),
        { date: input.date },
      );
    });
    res.sendStatus(204);
  });
  r.get("/audit-logs", owner, async (req, res) => {
    const p = pagination.strict().parse(req.query);
    res.json({
      logs: (
        await db.query(
          "SELECT a.*,u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.id DESC LIMIT $1 OFFSET $2",
          [p.page_size, (p.page - 1) * p.page_size],
        )
      ).rows,
      total: (await db.query("SELECT count(*)::int AS total FROM audit_logs"))
        .rows[0]?.total,
      ...p,
    });
  });
  return r;
}
