import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { readConfig } from "./config.js";
import { connectDatabase } from "./db.js";

const config = readConfig();
const db = connectDatabase(config.DATABASE_URL);
let failures = 0;
function report(level: "PASS" | "WARN" | "FAIL", message: string) {
  if (level === "FAIL") failures++;
  console.log(`[${level}] ${message}`);
}
try {
  await db.query("SELECT 1");
  report("PASS", "PostgreSQL connected (credentials hidden)");
  const applied = new Map(
    (await db.query("SELECT name,checksum FROM schema_migrations")).rows.map(
      (r) => [r.name, r.checksum],
    ),
  );
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const hash = createHash("sha256")
      .update(await readFile(resolve("migrations", name)))
      .digest("hex");
    report(applied.get(name) === hash ? "PASS" : "FAIL", `Migration ${name}`);
  }
  if (failures)
    throw new Error("Apply missing migrations before checking business data");
  const owner = Number(
    (
      await db.query(
        "SELECT count(*) n FROM users WHERE is_active AND role='owner'",
      )
    ).rows[0]!.n,
  );
  report(owner ? "PASS" : "FAIL", `Active owners: ${owner}`);
  const menus = (
    await db.query(`SELECT count(*) FILTER (WHERE p.is_available) AS available,
    count(*) FILTER (WHERE p.is_available AND NOT EXISTS (SELECT 1 FROM recipe_ingredients r WHERE r.product_id=p.id)) AS missing_recipes,
    count(*) FILTER (WHERE p.is_available AND p.image_url='') AS missing_images
    FROM products p WHERE NOT p.is_archived`)
  ).rows[0]!;
  report(
    Number(menus.available) ? "PASS" : "WARN",
    `Available menus: ${menus.available}`,
  );
  report(
    Number(menus.missing_recipes) ? "FAIL" : "PASS",
    `Available menus missing recipes: ${menus.missing_recipes}`,
  );
  report(
    Number(menus.missing_images) ? "WARN" : "PASS",
    `Available menus missing photos: ${menus.missing_images}`,
  );
  const inventory = (await db.query(`SELECT
    count(*) FILTER (WHERE btrim(i.unit)='')::int AS missing_units,
    count(*) FILTER (WHERE i.cost_satang=0)::int AS zero_costs,
    count(*) FILTER (WHERE s.counted_at IS NULL)::int AS uncounted
    FROM ingredients i LEFT JOIN branch_stock s ON s.ingredient_id=i.id AND s.branch_id=coffee_current_branch()
    WHERE i.is_active`)).rows[0]!;
  report(inventory.missing_units ? "FAIL" : "PASS", `Active ingredients without a base unit: ${inventory.missing_units}`);
  report(inventory.zero_costs ? "WARN" : "PASS", `Active ingredients with zero configured cost per base unit: ${inventory.zero_costs}`);
  report(inventory.uncounted ? "WARN" : "PASS", `Active ingredients awaiting a stock count: ${inventory.uncounted}`);
  const invalidRecipes = (await db.query(`SELECT p.name FROM branch_catalog p
    WHERE p.is_available AND NOT p.is_archived AND (EXISTS(
      SELECT 1 FROM recipe_ingredients r JOIN ingredients i ON i.id=r.ingredient_id
      WHERE r.product_id=p.id AND NOT i.is_active
    ) OR EXISTS(
      SELECT 1 FROM product_option_groups g JOIN product_options o ON o.group_id=g.id
      LEFT JOIN ingredients i ON i.id=o.ingredient_id
      LEFT JOIN recipe_ingredients r ON r.product_id=g.product_id AND r.ingredient_id=o.replaces_ingredient_id
      WHERE g.product_id=p.id AND ((o.ingredient_qty>0 AND NOT i.is_active)
        OR (o.replaces_ingredient_id IS NOT NULL AND r.ingredient_id IS NULL))
    )) ORDER BY p.name`)).rows;
  report(invalidRecipes.length ? "FAIL" : "PASS", `Menus with inactive recipe ingredients or invalid substitutions: ${invalidRecipes.map(p=>p.name).join(", ") || "0"}`);
  const supply = (await db.query(`SELECT
    (SELECT count(*)::int FROM suppliers WHERE is_active) AS suppliers,
    (SELECT count(*)::int FROM purchase_orders WHERE branch_id=coffee_current_branch() AND status='open'
      AND expected_on<(now() AT TIME ZONE 'Asia/Bangkok')::date) AS overdue,
    count(*) FILTER (WHERE expiry_kind='unknown')::int AS unknown_expiry,
    count(*) FILTER (WHERE expires_on<=(now() AT TIME ZONE 'Asia/Bangkok')::date)::int AS expired,
    count(*) FILTER (WHERE unit_cost_satang IS NULL)::int AS unknown_cost
    FROM inventory_lots WHERE branch_id=coffee_current_branch() AND remaining_qty>0`)).rows[0]!;
  report(supply.suppliers ? "PASS" : "WARN", `Active suppliers with configured lead time: ${supply.suppliers}`);
  report(supply.overdue ? "WARN" : "PASS", `Overdue open purchase orders: ${supply.overdue}`);
  report(supply.unknown_expiry || supply.expired || supply.unknown_cost ? "WARN" : "PASS",
    `Remaining lots: unknown expiry ${supply.unknown_expiry}, expired ${supply.expired}, unknown purchase cost ${supply.unknown_cost}`);
  const stock = (
    await db.query(
      "SELECT count(*) n FROM branch_stock s JOIN ingredients i ON i.id=s.ingredient_id JOIN branches b ON b.id=s.branch_id WHERE b.is_active AND i.is_active AND s.current_stock<=s.reorder_point",
    )
  ).rows[0]!.n;
  report(
    Number(stock) ? "WARN" : "PASS",
    `Branch/ingredient balances at/below reorder point: ${stock}`,
  );
  const demo = (
    await db.query("SELECT count(*) n FROM sales_daily WHERE source='demo'")
  ).rows[0]!.n;
  report(
    Number(demo) ? "WARN" : "PASS",
    `Demo history rows: ${demo}; never treat these as real accuracy evidence`,
  );
  const demoUsers = (
    await db.query(
      "SELECT count(*) n FROM users WHERE is_active AND email IN ('manager@example.com','cashier@example.com','kitchen@example.com')",
    )
  ).rows[0]!.n;
  report(
    Number(demoUsers) ? "WARN" : "PASS",
    `Accounts using development example emails: ${demoUsers}; provenance and current use require review; no account is classified for deletion`,
  );
  const unpaid = (
    await db.query(
      "SELECT count(*) n FROM orders o LEFT JOIN payments p ON p.order_id=o.id WHERE o.status<>'cancelled' AND p.order_id IS NULL",
    )
  ).rows[0]!.n;
  report(
    Number(unpaid) ? "WARN" : "PASS",
    `Unpaid orders: ${unpaid}; reconcile before day closing`,
  );
  report(
    existsSync("dist/client/index.html") ? "PASS" : "FAIL",
    "Built frontend (run npm run build after updating)",
  );
  for (const [label, url] of [
    ["API", `http://127.0.0.1:${config.PORT}/api/health`],
    ["Forecast", config.FORECAST_SERVICE_URL + "/health"],
  ]) {
    try {
      const result = await fetch(url!, { signal: AbortSignal.timeout(5000) });
      report(result.ok ? "PASS" : "FAIL", `${label} health`);
    } catch {
      report("FAIL", `${label} unavailable; start the service`);
    }
  }
  report(
    config.PUBLIC_ORIGIN &&
      !["localhost", "127.0.0.1"].includes(
        new URL(config.PUBLIC_ORIGIN).hostname,
      )
      ? "PASS"
      : "WARN",
    "Phone QR requires a reachable PUBLIC_ORIGIN and Wi-Fi/firewall access",
  );
  const folder = resolve(".local/backups");
  const manifests = existsSync(folder)
    ? (await readdir(folder)).filter((n) => n.endsWith(".dump.json")).sort()
    : [];
  const latest = manifests.at(-1);
  if (!latest)
    report(
      "WARN",
      "No local backup manifest; run npm run db:backup and keep a private off-device copy",
    );
  else {
    const manifest = JSON.parse(
      await readFile(resolve(folder, latest), "utf8"),
    );
    const age = Date.now() - Date.parse(manifest.created_at);
    report(
      Number.isFinite(age) && age >= 0 && age < 48 * 3600_000 ? "PASS" : "WARN",
      "Latest local backup age (use db:restore to verify recovery)",
    );
  }
  console.log(
    "Read-only checks complete. PASS is technical evidence, not a substitute for testing the shop's actual devices and procedures.",
  );
} catch {
  report(
    "FAIL",
    "Check could not finish; verify connection, schema and service configuration. No data was changed.",
  );
} finally {
  await db.close();
  process.exitCode = failures ? 1 : 0;
}
