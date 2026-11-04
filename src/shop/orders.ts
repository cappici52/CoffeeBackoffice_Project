import { createHash, randomUUID } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Database, Sql } from "../db.js";
import type { User } from "../security.js";
import {
  businessDate,
  fail,
  idSchema,
  moveStock,
  note,
  pagination,
  record,
  roundQty,
} from "./shared.js";

interface IngredientSnapshot {
  ingredient_id: string;
  name: string;
  unit: string;
  qty: number;
}
export const createInput = z
  .object({
    request_key: idSchema,
    type: z.enum(["dine-in", "takeaway"]),
    table_no: z.string().trim().max(30).default(""),
    note: note.default(""),
    payment_method: z.enum(["cash", "promptpay"]).optional(),
    items: z
      .array(
        z
          .object({
            product_id: idSchema,
            qty: z.number().int().min(1).max(99),
            option_ids: z.array(idSchema).max(100).default([]),
            note: note.default(""),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict()
  .refine(
    (v) => v.type !== "dine-in" || v.table_no.length > 0,
    "Table number required for dine-in",
  );
const itemColumns =
  "id,order_id,product_id,product_name,qty,unit_price_satang,status,station,note,options,ingredients,steps,target_prep_seconds,started_at,completed_at";
async function orderDetail(sql: Sql, id: string) {
  const order = (
    await sql.query(
      "SELECT o.*,p.method AS payment_method,p.status AS payment_status,p.paid_at,p.refunded_at,coalesce(u.name,'ลูกค้าสแกน QR') AS created_by_name FROM orders o LEFT JOIN payments p ON p.order_id=o.id LEFT JOIN users u ON u.id=o.created_by WHERE o.id=$1",
      [id],
    )
  ).rows[0];
  fail(order, 404, "ORDER_NOT_FOUND");
  return {
    ...order,
    items: (
      await sql.query(
        `SELECT ${itemColumns} FROM order_items WHERE order_id=$1 ORDER BY product_name,id`,
        [id],
      )
    ).rows,
  };
}
async function logStatus(
  sql: Sql,
  id: string,
  from: string | null,
  to: string,
  actor: User | null,
) {
  await sql.query(
    "INSERT INTO order_status_logs (order_id,from_status,to_status,changed_by) VALUES ($1,$2,$3,$4)",
    [id, from, to, actor?.id ?? null],
  );
}
async function openBusinessDate(sql: Sql, date = businessDate()) {
  fail(
    !(await sql.query("SELECT date FROM day_closings WHERE date=$1", [date]))
      .rows.length,
    409,
    "DAY_ALREADY_CLOSED",
  );
}
// Caller holds the order lock. Confirmation consumes snapshot ingredients once,
// whether staff accepts a dine-in order or receives an advance payment.
async function confirmOrder(sql: Sql, id: string, actor: User) {
  const items = (
    await sql.query(
      "SELECT qty,ingredients FROM order_items WHERE order_id=$1",
      [id],
    )
  ).rows;
  const needed = new Map<string, number>();
  for (const item of items)
    for (const i of item.ingredients as IngredientSnapshot[])
      needed.set(
        i.ingredient_id,
        roundQty((needed.get(i.ingredient_id) ?? 0) + i.qty * item.qty),
      );
  for (const [ingredientId, qty] of [...needed].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const i = (
      await sql.query(
        "SELECT s.current_stock,i.is_active FROM branch_stock s JOIN ingredients i ON i.id=s.ingredient_id WHERE s.ingredient_id=$1 AND s.branch_id=coffee_current_branch() FOR UPDATE OF s",
        [ingredientId],
      )
    ).rows[0];
    fail(
      i?.is_active && Number(i.current_stock) >= qty,
      409,
      "INSUFFICIENT_STOCK",
    );
    await moveStock(sql, actor, ingredientId, "sale", -qty, "ขายออเดอร์", id);
  }
  await sql.query(
    "UPDATE orders SET confirmed_at=now(),confirmed_by=$2,version=version+1 WHERE id=$1",
    [id, actor.id],
  );
}
async function payment(sql: Sql, id: string, method: string, actor: User) {
  await sql.query("SELECT pg_advisory_xact_lock(7301003)");
  const order = (
    await sql.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id])
  ).rows[0];
  fail(order, 404, "ORDER_NOT_FOUND");
  const paid = (
    await sql.query("SELECT * FROM payments WHERE order_id=$1", [id])
  ).rows[0];
  if (paid) {
    fail(
      paid.status === "paid" && paid.method === method,
      409,
      "PAYMENT_CONFLICT",
    );
    return;
  }
  await openBusinessDate(sql);
  fail(order.status !== "cancelled", 409, "INVALID_ORDER_TRANSITION");
  if (!order.confirmed_at) {
    fail(order.status === "pending", 409, "INVALID_ORDER_TRANSITION");
    await confirmOrder(sql, id, actor);
  }
  await sql.query(
    "INSERT INTO payments (order_id,method,amount_satang,status,confirmed_by) VALUES ($1,$2,$3,'paid',$4)",
    [id, method, order.total_satang, actor.id],
  );
  await logStatus(sql, id, order.status, order.status, actor);
  await record(sql, actor, "order.paid", "order", id, {
    method,
    total_satang: order.total_satang,
  });
}
export async function createOrder(
  db: Database,
  input: z.infer<typeof createInput>,
  actor: User | null,
  guest?: {
    table_id: string;
    tracking_hash: string;
    table_token: string;
    expected_total_satang: number;
  },
) {
  fail(actor || guest, 403, "FORBIDDEN");
  if (guest)
    fail(
      !actor && !input.payment_method && input.type === "dine-in",
      400,
      "INVALID_GUEST_ORDER",
    );
  const hash = createHash("sha256")
    .update(
      JSON.stringify(
        guest
          ? {
              request_key: input.request_key,
              items: input.items,
              note: input.note,
              table_id: guest.table_id,
              tracking_hash: guest.tracking_hash,
              expected_total_satang: guest.expected_total_satang,
            }
          : input,
      ),
    )
    .digest("hex");
  const id = await db.transaction(async (sql) => {
    // One logical order per key, even across simultaneous retries and API processes.
    await sql.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      input.request_key,
    ]);
    const previous = (
      await sql.query(
        "SELECT id,request_hash FROM orders WHERE request_key=$1",
        [input.request_key],
      )
    ).rows[0];
    if (previous) {
      fail(previous.request_hash === hash, 409, "IDEMPOTENCY_CONFLICT");
      return previous.id as string;
    }
    let tableNo = input.table_no;
    if (guest) {
      await sql.query("SELECT pg_advisory_xact_lock(7301003)");
      await openBusinessDate(sql);
      const table = (
        await sql.query(
          "SELECT name FROM dining_tables WHERE id=$1 AND qr_token=$2 AND is_active FOR UPDATE",
          [guest.table_id, guest.table_token],
        )
      ).rows[0];
      fail(table, 404, "TABLE_UNAVAILABLE");
      tableNo = table.name;
      const pending = (
        await sql.query(
          "SELECT count(*)::int AS count FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE o.dining_table_id=$1 AND o.status='pending' AND p.order_id IS NULL",
          [guest.table_id],
        )
      ).rows[0]?.count;
      fail(pending < 10, 429, "TABLE_ORDER_LIMIT");
    }
    const orderId = randomUUID();
    let total = 0;
    const snapshots = [];
    for (const line of input.items) {
      const p = (
        await sql.query(
          "SELECT * FROM branch_catalog WHERE id=$1 AND is_available AND NOT is_archived",
          [line.product_id],
        )
      ).rows[0];
      fail(p, 409, "PRODUCT_UNAVAILABLE");
      fail(
        (
          await sql.query(
            "SELECT product_id FROM recipes WHERE product_id=$1",
            [p.id],
          )
        ).rows[0],
        409,
        "RECIPE_REQUIRED",
      );
      const groups = (
        await sql.query(
          "SELECT * FROM product_option_groups WHERE product_id=$1",
          [p.id],
        )
      ).rows;
      const options = (
        await sql.query(
          "SELECT o.*,g.name AS group_name FROM product_options o JOIN product_option_groups g ON g.id=o.group_id WHERE g.product_id=$1",
          [p.id],
        )
      ).rows;
      fail(
        new Set(line.option_ids).size === line.option_ids.length,
        400,
        "INVALID_OPTIONS",
      );
      const selected = line.option_ids.map((id) => {
        const o = options.find((o) => o.id === id);
        fail(o, 400, "INVALID_OPTIONS");
        return o;
      });
      for (const group of groups) {
        const count = selected.filter((o) => o.group_id === group.id).length;
        fail(
          (!group.is_required || count > 0) &&
            (group.multi_select || count <= 1),
          400,
          "INVALID_OPTIONS",
        );
      }
      const recipe = (
        await sql.query(
          "SELECT ri.ingredient_id,ri.qty,i.name,i.unit,i.cost_satang,i.is_active FROM recipe_ingredients ri JOIN ingredients i ON i.id=ri.ingredient_id WHERE ri.product_id=$1",
          [p.id],
        )
      ).rows;
      const quantities = new Map<string, number>(
        recipe.map((i) => [i.ingredient_id, Number(i.qty)]),
      );
      const replaced = new Set<string>();
      for (const o of selected) {
        if (o.replaces_ingredient_id) {
          fail(
            quantities.has(o.replaces_ingredient_id) &&
              !replaced.has(o.replaces_ingredient_id),
            400,
            "INVALID_SUBSTITUTION",
          );
          quantities.delete(o.replaces_ingredient_id);
          replaced.add(o.replaces_ingredient_id);
        }
        if (o.ingredient_id && Number(o.ingredient_qty) > 0)
          quantities.set(
            o.ingredient_id,
            roundQty(
              (quantities.get(o.ingredient_id) ?? 0) + Number(o.ingredient_qty),
            ),
          );
      }
      const ingredients: IngredientSnapshot[] = [];
      let cost = 0;
      for (const [ingredientId, qty] of quantities) {
        const i = (
          await sql.query(
            "SELECT * FROM ingredients WHERE id=$1 AND is_active",
            [ingredientId],
          )
        ).rows[0];
        fail(i, 409, "INVALID_INGREDIENT");
        ingredients.push({
          ingredient_id: ingredientId,
          name: i.name,
          unit: i.unit,
          qty,
        });
        cost += Number(i.cost_satang) * qty;
      }
      const price =
        p.price_satang +
        selected.reduce((sum, o) => sum + o.extra_price_satang, 0);
      total += price * line.qty;
      fail(
        Number.isSafeInteger(total) && total <= 2_000_000_000,
        400,
        "ORDER_TOO_LARGE",
      );
      const steps = (
        await sql.query(
          "SELECT step_no,instruction,image_url,timer_seconds FROM recipe_steps WHERE product_id=$1 ORDER BY step_no",
          [p.id],
        )
      ).rows;
      snapshots.push({
        id: randomUUID(),
        product: p,
        line,
        price,
        cost,
        ingredients,
        steps,
        options: selected.map((o) => ({
          id: o.id,
          name: o.name,
          group_name: o.group_name,
          extra_price_satang: o.extra_price_satang,
        })),
      });
    }
    if (guest)
      fail(total === guest.expected_total_satang, 409, "MENU_PRICE_CHANGED");
    await sql.query(
      "INSERT INTO orders (id,request_key,request_hash,type,table_no,note,total_satang,created_by,source,dining_table_id,guest_tracking_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        orderId,
        input.request_key,
        hash,
        input.type,
        input.type === "dine-in" ? tableNo : "",
        input.note,
        total,
        actor?.id ?? null,
        guest ? "qr" : "pos",
        guest?.table_id ?? null,
        guest?.tracking_hash ?? null,
      ],
    );
    for (const s of snapshots)
      await sql.query(
        "INSERT INTO order_items (id,order_id,product_id,product_name,qty,unit_price_satang,unit_cost_satang,station,note,options,ingredients,steps,target_prep_seconds) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        [
          s.id,
          orderId,
          s.product.id,
          s.product.name,
          s.line.qty,
          s.price,
          s.cost,
          s.product.station,
          s.line.note,
          JSON.stringify(s.options),
          JSON.stringify(s.ingredients),
          JSON.stringify(s.steps),
          s.product.target_prep_seconds,
        ],
      );
    await logStatus(sql, orderId, null, "pending", actor);
    if (input.payment_method && actor)
      await payment(sql, orderId, input.payment_method, actor);
    return orderId;
  });
  return id;
}

export function ordersRouter(
  db: Database,
  auth: RequestHandler,
  front: RequestHandler,
) {
  const r = Router();
  r.use(["/orders", "/kds", "/events"], auth);
  r.post("/orders", front, async (req, res) => {
    const id = await createOrder(
      db,
      createInput.parse(req.body),
      res.locals.user as User,
    );
    res.status(201).json({ order: await orderDetail(db, id) });
  });
  r.get("/orders", front, async (req, res) => {
    const p = pagination
      .extend({
        status: z
          .enum([
            "all",
            "pending",
            "preparing",
            "ready",
            "completed",
            "cancelled",
          ])
          .default("all"),
      })
      .strict()
      .parse(req.query);
    const rows = (
      await db.query(
        "SELECT o.*,p.status AS payment_status,p.method AS payment_method FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE ($1='all' OR o.status=$1) ORDER BY o.created_at DESC,o.id LIMIT $2 OFFSET $3",
        [p.status, p.page_size, (p.page - 1) * p.page_size],
      )
    ).rows;
    const count = (
      await db.query(
        "SELECT count(*)::int AS total FROM orders WHERE ($1='all' OR status=$1)",
        [p.status],
      )
    ).rows[0]?.total;
    res.json({
      orders: rows,
      total: count,
      ...p,
      server_time: new Date().toISOString(),
    });
  });
  r.get("/orders/summary", front, async (_req, res) =>
    res.json(
      (
        await db.query(
          "SELECT count(*)::int AS unpaid, count(*) FILTER(WHERE o.source='qr')::int AS qr_unpaid FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE o.status<>'cancelled' AND p.order_id IS NULL",
        )
      ).rows[0],
    ),
  );
  r.get("/orders/:id", front, async (req, res) =>
    res.json({ order: await orderDetail(db, idSchema.parse(req.params.id)) }),
  );
  r.post("/orders/:id/pay", front, async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const p = z
      .object({ method: z.enum(["cash", "promptpay"]) })
      .strict()
      .parse(req.body);
    await db.transaction((sql) => payment(sql, id, p.method, res.locals.user));
    res.json({ order: await orderDetail(db, id) });
  });
  r.post("/orders/:id/confirm", front, async (req, res) => {
    const id = idSchema.parse(req.params.id);
    z.object({}).strict().parse(req.body);
    const actor = res.locals.user as User;
    await db.transaction(async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(7301003)");
      const order = (
        await sql.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      fail(order, 404, "ORDER_NOT_FOUND");
      fail(order.status !== "cancelled", 409, "INVALID_ORDER_TRANSITION");
      if (order.confirmed_at) return;
      fail(
        order.type === "dine-in" && order.status === "pending",
        409,
        "INVALID_ORDER_TRANSITION",
      );
      await openBusinessDate(sql);
      await confirmOrder(sql, id, actor);
      await logStatus(sql, id, order.status, order.status, actor);
      await record(sql, actor, "order.confirmed", "order", id);
    });
    res.json({ order: await orderDetail(db, id) });
  });
  r.post("/orders/:id/status", front, async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const p = z
      .object({
        status: z.enum(["completed", "cancelled"]),
        reason: note.default(""),
        confirm_refund: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    const actor = res.locals.user as User;
    await db.transaction(async (sql) => {
      // Same order as payment/closing locks prevents payment-cancel-close deadlocks.
      await sql.query("SELECT pg_advisory_xact_lock(7301003)");
      const o = (
        await sql.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [id])
      ).rows[0];
      fail(o, 404, "ORDER_NOT_FOUND");
      if (o.status === p.status) return;
      fail(
        !["completed", "cancelled"].includes(o.status),
        409,
        "INVALID_ORDER_TRANSITION",
      );
      const paid = (
        await sql.query(
          "SELECT *, (paid_at AT TIME ZONE 'Asia/Bangkok')::date::text AS date FROM payments WHERE order_id=$1",
          [id],
        )
      ).rows[0];
      if (p.status === "completed") {
        fail(
          o.status === "ready" && o.confirmed_at,
          409,
          "INVALID_ORDER_TRANSITION",
        );
        await sql.query(
          "UPDATE order_items SET status='completed' WHERE order_id=$1",
          [id],
        );
        await sql.query(
          "UPDATE orders SET status='completed',completed_at=now(),version=version+1 WHERE id=$1",
          [id],
        );
      } else {
        fail(p.reason.length > 0, 400, "CANCEL_REASON_REQUIRED");
        if (paid?.status === "paid") {
          fail(
            ["owner", "manager"].includes(actor.role),
            403,
            "REFUND_REQUIRES_MANAGER",
          );
          fail(p.confirm_refund, 400, "REFUND_CONFIRMATION_REQUIRED");
          await openBusinessDate(sql, paid.date);
          await sql.query(
            "UPDATE payments SET status='refunded',refunded_at=now() WHERE order_id=$1",
            [id],
          );
        }
        if (o.confirmed_at) {
          // Only unstarted orders can return their ingredients to stock.
          const started =
            (
              await sql.query(
                "SELECT id FROM order_items WHERE order_id=$1 AND started_at IS NOT NULL",
                [id],
              )
            ).rows.length > 0;
          if (!started) {
            const movements = (
              await sql.query(
                "SELECT ingredient_id,qty FROM stock_movements WHERE ref_order_id=$1 AND type='sale' ORDER BY ingredient_id",
                [id],
              )
            ).rows;
            for (const m of movements) {
              await sql.query(
                "SELECT ingredient_id AS id FROM branch_stock WHERE ingredient_id=$1 AND branch_id=coffee_current_branch() FOR UPDATE",
                [m.ingredient_id],
              );
              await moveStock(
                sql,
                actor,
                m.ingredient_id,
                "return",
                -Number(m.qty),
                "ยกเลิกก่อนเริ่มทำ",
                id,
              );
            }
          }
        }
        await sql.query(
          "UPDATE order_items SET status='cancelled' WHERE order_id=$1",
          [id],
        );
        await sql.query(
          "UPDATE orders SET status='cancelled',cancelled_at=now(),cancel_reason=$2,version=version+1 WHERE id=$1",
          [id, p.reason],
        );
      }
      await logStatus(sql, id, o.status, p.status, actor);
      await record(sql, actor, "order." + p.status, "order", id, {
        reason: p.reason,
      });
    });
    res.json({ order: await orderDetail(db, id) });
  });
  r.get("/kds", async (req, res) => {
    const p = z
      .object({ station: z.enum(["all", "bar", "kitchen"]).default("all") })
      .strict()
      .parse(req.query);
    const orders = (
      await db.query(
        "SELECT o.id,o.order_no,o.type,o.table_no,o.note,o.created_at,o.status FROM orders o WHERE o.status IN ('pending','preparing','ready') AND o.confirmed_at IS NOT NULL ORDER BY o.created_at,o.id",
      )
    ).rows;
    const items = (
      await db.query(
        `SELECT ${itemColumns
          .split(",")
          .map((c) => "i." + c)
          .join(
            ",",
          )} FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status IN ('pending','preparing','ready') AND o.confirmed_at IS NOT NULL AND ($1='all' OR i.station=$1) ORDER BY o.created_at,i.product_name`,
        [p.station],
      )
    ).rows;
    // Kitchen receives no prices, costs, payments or revenue fields.
    res.json({
      server_time: new Date().toISOString(),
      orders: orders
        .map((o) => ({
          ...o,
          items: items
            .filter((i) => i.order_id === o.id)
            .map(({ unit_price_satang: _, ...item }) => ({
              ...item,
              options: item.options.map(
                (option: { id: string; name: string; group_name: string }) => ({
                  id: option.id,
                  name: option.name,
                  group_name: option.group_name,
                }),
              ),
            })),
        }))
        .filter((o) => o.items.length),
    });
  });
  r.post("/kds/items/:id/status", async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { status } = z
      .object({ status: z.enum(["preparing", "ready"]) })
      .strict()
      .parse(req.body);
    const actor = res.locals.user as User;
    await db.transaction(async (sql) => {
      const item = (
        await sql.query("SELECT order_id FROM order_items WHERE id=$1", [id])
      ).rows[0];
      fail(item, 404, "NOT_FOUND");
      const order = (
        await sql.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
          item.order_id,
        ])
      ).rows[0];
      fail(
        order && !["completed", "cancelled"].includes(order.status),
        409,
        "INVALID_ORDER_TRANSITION",
      );
      fail(order.confirmed_at, 409, "ORDER_CONFIRMATION_REQUIRED");
      const current = (
        await sql.query("SELECT * FROM order_items WHERE id=$1 FOR UPDATE", [
          id,
        ])
      ).rows[0]!;
      if (current.status === status) return;
      fail(
        status === "preparing"
          ? current.status === "pending"
          : current.status === "preparing",
        409,
        "INVALID_ORDER_TRANSITION",
      );
      if (status === "preparing")
        await sql.query(
          "UPDATE order_items SET status='preparing',started_at=now() WHERE id=$1",
          [id],
        );
      else
        await sql.query(
          "UPDATE order_items SET status='ready',completed_at=now() WHERE id=$1",
          [id],
        );
      const all = (
        await sql.query("SELECT status FROM order_items WHERE order_id=$1", [
          order.id,
        ])
      ).rows;
      const next = all.every((i) => i.status === "ready")
        ? "ready"
        : "preparing";
      await sql.query(
        "UPDATE orders SET status=$2,version=version+1 WHERE id=$1",
        [order.id, next],
      );
      await logStatus(sql, order.id, order.status, next, actor);
    });
    res.sendStatus(204);
  });
  r.get("/events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    let busy = false;
    let ended = false;
    let previous = "";
    const tick = async () => {
      if (busy || ended) return;
      busy = true;
      try {
        const live = (
          await db.query(
            "SELECT s.user_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.is_active",
            [res.locals.sessionHash],
          )
        ).rows[0];
        if (!live) {
          res.write("event: session-expired\ndata: {}\n\n");
          res.end();
          return;
        }
        const revision = String(
          (
            await db.query(
              "SELECT coalesce(max(id),0) AS revision FROM order_status_logs",
            )
          ).rows[0]?.revision,
        );
        if (revision !== previous) {
          res.write(
            `data: ${JSON.stringify({ revision, server_time: new Date().toISOString() })}\n\n`,
          );
          previous = revision;
        } else res.write(": heartbeat\n\n");
      } catch {
        if (!ended) res.end();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void tick(), 2000);
    void tick();
    req.on("close", () => {
      ended = true;
      clearInterval(timer);
    });
  });
  return r;
}
