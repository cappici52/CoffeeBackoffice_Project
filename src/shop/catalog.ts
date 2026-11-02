import { randomUUID } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import type { Database, Sql } from "../db.js";
import type { User } from "../security.js";
import {
  fail,
  idSchema,
  imageUrl,
  money,
  note,
  pagination,
  quantity,
  record,
  text,
} from "./shared.js";

const option = z
  .object({
    name: text,
    extra_price_satang: money.default(0),
    ingredient_id: idSchema.nullable().default(null),
    ingredient_qty: z
      .union([quantity, z.literal(0)])
      .nullable()
      .default(null),
    replaces_ingredient_id: idSchema.nullable().default(null),
  })
  .strict()
  .refine(
    (v) =>
      v.ingredient_id
        ? v.ingredient_qty !== null
        : v.ingredient_qty === null && v.replaces_ingredient_id === null,
    "Ingredient and quantity must be provided together",
  );
const group = z
  .object({
    name: text,
    is_required: z.boolean(),
    multi_select: z.boolean(),
    options: z.array(option).min(1).max(30),
  })
  .strict();
const productFields = z
  .object({
    category_id: idSchema,
    name: text,
    description: note.default(""),
    price_satang: money,
    image_url: imageUrl.default(""),
    is_available: z.boolean().default(true),
    target_prep_seconds: z.number().int().min(1).max(7200).default(180),
    station: z.enum(["bar", "kitchen"]).default("bar"),
    option_groups: z.array(group).max(10).default([]),
  })
  .strict();
export async function catalog(sql: Sql) {
  const products = (
    await sql.query<{ id: string; name: string }>(
      "SELECT * FROM products WHERE NOT is_archived ORDER BY name,id",
    )
  ).rows;
  const groups = (
    await sql.query(
      "SELECT * FROM product_option_groups ORDER BY sort_order,id",
    )
  ).rows;
  const options = (
    await sql.query("SELECT * FROM product_options ORDER BY sort_order,id")
  ).rows;
  return products.map((p) => ({
    ...p,
    option_groups: groups
      .filter((g) => g.product_id === p.id)
      .map((g) => ({
        ...g,
        options: options.filter((o) => o.group_id === g.id),
      })),
  }));
}
async function saveGroups(
  sql: Sql,
  productId: string,
  groups: z.infer<typeof productFields>["option_groups"],
) {
  await sql.query("DELETE FROM product_option_groups WHERE product_id=$1", [
    productId,
  ]);
  for (const [index, g] of groups.entries()) {
    const groupId = randomUUID();
    await sql.query(
      "INSERT INTO product_option_groups (id,product_id,name,is_required,multi_select,sort_order) VALUES ($1,$2,$3,$4,$5,$6)",
      [groupId, productId, g.name, g.is_required, g.multi_select, index],
    );
    for (const [oi, o] of g.options.entries())
      await sql.query(
        "INSERT INTO product_options (id,group_id,name,extra_price_satang,ingredient_id,ingredient_qty,replaces_ingredient_id,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          randomUUID(),
          groupId,
          o.name,
          o.extra_price_satang,
          o.ingredient_id,
          o.ingredient_qty,
          o.replaces_ingredient_id,
          oi,
        ],
      );
  }
}
export function catalogRouter(
  db: Database,
  auth: RequestHandler,
  manage: RequestHandler,
  read: RequestHandler,
) {
  const router = Router();
  router.use(auth);
  router.get("/catalog", read, async (_req, res) =>
    res.json({
      products: await catalog(db),
      categories: (
        await db.query("SELECT * FROM categories ORDER BY sort_order,name")
      ).rows,
    }),
  );
  router.get("/products", manage, async (req, res) => {
    const input = pagination
      .extend({ q: z.string().max(120).default("") })
      .strict()
      .parse(req.query);
    const all = (await catalog(db)).filter((p) =>
      p.name.toLocaleLowerCase().includes(input.q.toLocaleLowerCase()),
    );
    res.json({
      products: all.slice(
        (input.page - 1) * input.page_size,
        input.page * input.page_size,
      ),
      total: all.length,
      ...input,
    });
  });
  router.post("/categories", manage, async (req, res) => {
    const input = z
      .object({
        name: text,
        sort_order: z.number().int().min(0).max(10000).default(0),
      })
      .strict()
      .parse(req.body);
    const category = await db.transaction(async (sql) => {
      const id = randomUUID();
      const r = await sql.query(
        "INSERT INTO categories (id,name,sort_order) VALUES ($1,$2,$3) RETURNING *",
        [id, input.name, input.sort_order],
      );
      await record(
        sql,
        res.locals.user,
        "category.created",
        "category",
        id,
        input,
      );
      return r.rows[0];
    });
    res.status(201).json({ category });
  });
  router.patch("/categories/:id", manage, async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const input = z
      .object({ name: text, sort_order: z.number().int().min(0).max(10000) })
      .strict()
      .parse(req.body);
    const category = await db.transaction(async (sql) => {
      const r = await sql.query(
        "UPDATE categories SET name=$1,sort_order=$2 WHERE id=$3 RETURNING *",
        [input.name, input.sort_order, id],
      );
      fail(r.rows[0], 404, "NOT_FOUND");
      await record(
        sql,
        res.locals.user,
        "category.updated",
        "category",
        id,
        input,
      );
      return r.rows[0];
    });
    res.json({ category });
  });
  router.delete("/categories/:id", manage, async (req, res) => {
    const id = idSchema.parse(req.params.id);
    await db.transaction(async (sql) => {
      const r = await sql.query(
        "DELETE FROM categories WHERE id=$1 RETURNING id",
        [id],
      );
      fail(r.rows[0], 404, "NOT_FOUND");
      await record(sql, res.locals.user, "category.deleted", "category", id);
    });
    res.sendStatus(204);
  });
  router.post("/products", manage, async (req, res) => {
    const input = productFields.parse(req.body);
    const id = randomUUID();
    await db.transaction(async (sql) => {
      await sql.query(
        "INSERT INTO products (id,category_id,name,description,price_satang,image_url,is_available,target_prep_seconds,station) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          id,
          input.category_id,
          input.name,
          input.description,
          input.price_satang,
          input.image_url,
          input.is_available,
          input.target_prep_seconds,
          input.station,
        ],
      );
      await saveGroups(sql, id, input.option_groups);
      await record(sql, res.locals.user, "product.created", "product", id, {
        name: input.name,
        price_satang: input.price_satang,
      });
    });
    res
      .status(201)
      .json({ product: (await catalog(db)).find((p) => p.id === id) });
  });
  router.patch("/products/:id", manage, async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const input = productFields
      .partial()
      .extend({ expected_version: z.number().int().positive() })
      .strict()
      .parse(req.body);
    await db.transaction(async (sql) => {
      const current = (
        await sql.query(
          "SELECT * FROM products WHERE id=$1 AND NOT is_archived FOR UPDATE",
          [id],
        )
      ).rows[0];
      fail(current, 404, "NOT_FOUND");
      fail(current.version === input.expected_version, 409, "VERSION_CONFLICT");
      const p = { ...current, ...input };
      await sql.query(
        "UPDATE products SET category_id=$1,name=$2,description=$3,price_satang=$4,image_url=$5,is_available=$6,target_prep_seconds=$7,station=$8,version=version+1 WHERE id=$9",
        [
          p.category_id,
          p.name,
          p.description,
          p.price_satang,
          p.image_url,
          p.is_available,
          p.target_prep_seconds,
          p.station,
          id,
        ],
      );
      if (input.option_groups) await saveGroups(sql, id, input.option_groups);
      await record(
        sql,
        res.locals.user,
        "product.updated",
        "product",
        id,
        input,
      );
    });
    res.json({ product: (await catalog(db)).find((p) => p.id === id) });
  });
  router.delete("/products/:id", manage, async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { expected_version } = z
      .object({ expected_version: z.number().int().positive() })
      .strict()
      .parse(req.body);
    await db.transaction(async (sql) => {
      const r = await sql.query(
        "UPDATE products SET is_archived=true,is_available=false,version=version+1 WHERE id=$1 AND version=$2 AND NOT is_archived RETURNING id",
        [id, expected_version],
      );
      fail(r.rows[0], 409, "VERSION_CONFLICT");
      await record(
        sql,
        res.locals.user as User,
        "product.archived",
        "product",
        id,
      );
    });
    res.sendStatus(204);
  });
  return router;
}
