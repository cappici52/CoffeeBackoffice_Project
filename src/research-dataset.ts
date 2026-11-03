import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Database } from "./db.js";
import { connectDatabase } from "./db.js";
import { readConfig } from "./config.js";
import { dateSchema, idSchema } from "./shop/shared.js";

const payloadSchema = z
  .object({
    format: z.literal("coffee-public-dataset-v1"),
    id: idSchema,
    data_mode: z.literal("PUBLIC_DATASET"),
    content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().min(1),
    version: z.string().min(1),
    source_url: z.url(),
    license: z.string().min(1),
    license_url: z.url(),
    attribution: z.string().min(1),
    transform_version: z.string().min(1),
    report: z
      .object({ item_occurrences: z.number().int().nonnegative() })
      .passthrough(),
    products: z
      .array(
        z
          .object({
            id: idSchema,
            external_id: z.string().min(1),
            name: z.string().min(1),
          })
          .passthrough(),
      )
      .min(1)
      .max(1000),
    outlets: z
      .array(
        z
          .object({
            id: z.string().min(1),
            date_from: dateSchema,
            date_to: dateSchema,
          })
          .passthrough(),
      )
      .min(1)
      .max(100),
    daily: z
      .array(
        z.object({
          outlet_id: z.string().min(1),
          product_id: idSchema,
          date: dateSchema,
          qty: z.number().int().min(0).max(1e6),
          quality: z.enum(["observed", "inferred_zero"]),
        }),
      )
      .min(1)
      .max(1000000),
  })
  .passthrough();

export async function importPublicDataset(db: Database, value: unknown) {
  const data = payloadSchema.parse(value),
    { daily, ...metadata } = data;
  const ids = new Set(data.products.map((p) => p.id)),
    outlets = new Set(data.outlets.map((o) => o.id)),
    keys = new Set<string>();
  if (ids.size !== data.products.length || outlets.size !== data.outlets.length)
    throw new Error("Duplicate dataset identities");
  for (const r of daily) {
    const key = [r.outlet_id, r.product_id, r.date].join(":");
    const coverage = data.outlets.find((o) => o.id === r.outlet_id);
    if (
      !ids.has(r.product_id) ||
      !coverage ||
      r.date < coverage.date_from ||
      r.date > coverage.date_to ||
      keys.has(key) ||
      (r.quality === "inferred_zero" && r.qty !== 0)
    )
      throw new Error("Invalid normalized daily observation");
    keys.add(key);
  }
  if (daily.reduce((sum, r) => sum + r.qty, 0) !== data.report.item_occurrences)
    throw new Error("Dataset quantities do not reconcile");
  const digest = createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
  return db.transaction(async (sql) => {
    await sql.query("SELECT pg_advisory_xact_lock(7301006)");
    const previous = (
      await sql.query(
        "SELECT id,prepared_sha256 FROM research_datasets WHERE content_sha256=$1",
        [data.content_sha256],
      )
    ).rows[0];
    if (previous) {
      if (previous.id !== data.id || previous.prepared_sha256 !== digest)
        throw new Error(
          "Existing import differs; use a new transformation version",
        );
      return { id: previous.id, imported: false, rows: daily.length };
    }
    await sql.query(
      "INSERT INTO research_datasets(id,content_sha256,prepared_sha256,metadata) VALUES($1,$2,$3,$4)",
      [data.id, data.content_sha256, digest, JSON.stringify(metadata)],
    );
    for (let offset = 0; offset < daily.length; offset += 2000)
      await sql.query(
        `INSERT INTO research_daily_demand(dataset_id,outlet_id,product_id,date,qty,quality)
    SELECT $1,x.outlet_id,x.product_id,x.date,x.qty,x.quality FROM jsonb_to_recordset($2::jsonb) AS x(outlet_id text,product_id uuid,date date,qty numeric,quality text)`,
        [data.id, JSON.stringify(daily.slice(offset, offset + 2000))],
      );
    return { id: data.id, imported: true, rows: daily.length };
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const path = process.argv[2];
  if (!path)
    throw new Error("Usage: npm run dataset:import -- path/to/prepared.json");
  const db = connectDatabase(readConfig().DATABASE_URL);
  try {
    console.log(
      JSON.stringify(
        await importPublicDataset(
          db,
          JSON.parse(await readFile(resolve(path), "utf8")),
        ),
      ),
    );
  } finally {
    await db.close();
  }
}
