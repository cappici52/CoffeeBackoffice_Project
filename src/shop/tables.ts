import { randomUUID } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Database } from "../db.js";
import type { Config } from "../config.js";
import { newToken } from "../security.js";
import { fail, idSchema, pagination, record } from "./shared.js";

export function publicOrigin(config: Config) {
  return config.PUBLIC_ORIGIN ?? config.APP_ORIGIN;
}
export function tablesRouter(
  db: Database,
  config: Config,
  auth: RequestHandler,
  manage: RequestHandler,
) {
  const r = Router();
  r.use("/tables", auth, manage);
  r.get("/tables", async (req, res) => {
    const p = pagination.strict().parse(req.query);
    const count = (
      await db.query("SELECT count(*)::int AS total FROM dining_tables")
    ).rows[0]?.total;
    const tables = (
      await db.query(
        "SELECT id,name,qr_token,is_active,version FROM dining_tables ORDER BY created_at,id LIMIT $1 OFFSET $2",
        [p.page_size, (p.page - 1) * p.page_size],
      )
    ).rows.map((t) => ({
      ...t,
      menu_url: `${publicOrigin(config)}/table/${t.qr_token}`,
    }));
    res.json({
      tables,
      total: count,
      public_origin: publicOrigin(config),
      ...p,
    });
  });
  r.post("/tables", async (req, res) => {
    const p = z
      .object({ name: z.string().trim().min(1).max(30) })
      .strict()
      .parse(req.body);
    const id = randomUUID();
    await db.transaction(async (sql) => {
      await sql.query(
        "INSERT INTO dining_tables (id,name,qr_token) VALUES ($1,$2,$3)",
        [id, p.name, newToken()],
      );
      await record(sql, res.locals.user, "table.created", "table", id, {
        name: p.name,
      });
    });
    res.status(201).json({ id });
  });
  r.patch("/tables/:id", async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const p = z
      .object({
        name: z.string().trim().min(1).max(30),
        is_active: z.boolean(),
        expected_version: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    await db.transaction(async (sql) => {
      const result = await sql.query(
        "UPDATE dining_tables SET name=$1,is_active=$2,version=version+1 WHERE id=$3 AND version=$4 RETURNING id",
        [p.name, p.is_active, id, p.expected_version],
      );
      fail(result.rows[0], 409, "VERSION_CONFLICT");
      await record(sql, res.locals.user, "table.updated", "table", id, {
        name: p.name,
        is_active: p.is_active,
      });
    });
    res.sendStatus(204);
  });
  r.post("/tables/:id/rotate", async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const p = z
      .object({ expected_version: z.number().int().positive() })
      .strict()
      .parse(req.body);
    await db.transaction(async (sql) => {
      const result = await sql.query(
        "UPDATE dining_tables SET qr_token=$1,version=version+1 WHERE id=$2 AND version=$3 RETURNING id",
        [newToken(), id, p.expected_version],
      );
      fail(result.rows[0], 409, "VERSION_CONFLICT");
      await record(sql, res.locals.user, "table.qr_rotated", "table", id);
    });
    res.sendStatus(204);
  });
  return r;
}
