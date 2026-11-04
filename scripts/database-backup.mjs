import "dotenv/config";
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { prepareBranchRole,restoreBranchGrants } from './branch-backup-access.mjs';
import pg from "pg";

export async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function connection(url, database) {
  const parsed = new URL(url);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error("A PostgreSQL DATABASE_URL is required");
  const env = {
    ...process.env,
    PGHOST: parsed.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: database ?? decodeURIComponent(parsed.pathname.slice(1)),
    PGCONNECT_TIMEOUT: "10",
  };
  const options = {
    sslmode: "PGSSLMODE",
    sslrootcert: "PGSSLROOTCERT",
    sslcert: "PGSSLCERT",
    sslkey: "PGSSLKEY",
    options: "PGOPTIONS",
  };
  for (const [key, value] of parsed.searchParams) {
    if (!options[key])
      throw new Error("Unsupported DATABASE_URL option for backup tools");
    env[options[key]] = value;
  }
  return env;
}

function executable(name) {
  const binary = process.platform === "win32" ? name + ".exe" : name;
  if (process.env.PG_BIN) return join(process.env.PG_BIN, binary);
  if (process.platform === "win32") {
    const installed = join(
      process.env.ProgramFiles ?? "C:/Program Files",
      "PostgreSQL",
      "18",
      "bin",
      binary,
    );
    if (existsSync(installed)) return installed;
  }
  return binary;
}

async function command(name, args, env) {
  await new Promise((done, reject) => {
    // No shell, URL or credentials in command arguments/output.
    const child = spawn(executable(name), args, {
      env,
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", () =>
      reject(
        new Error(
          `Cannot start ${name}; install PostgreSQL 18 client tools or set PG_BIN`,
        ),
      ),
    );
    child.once("exit", (code) =>
      code === 0
        ? done()
        : reject(
            new Error(
              `${name} failed (exit ${code}); check permissions, free space and client/server version`,
            ),
          ),
    );
  });
}

async function inventory(client) {
  const tables = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
  );
  const counts = {};
  for (const { tablename } of tables.rows) {
    // Identifiers originate in pg_catalog; quote even if a future name contains punctuation.
    const quoted = '"' + tablename.replaceAll('"', '""') + '"';
    counts[tablename] = (
      await client.query(`SELECT count(*)::text AS n FROM public.${quoted}`)
    ).rows[0].n;
  }
  return counts;
}

export async function backupDatabase(
  url,
  directory = resolve(".local/backups"),
) {
  const env = connection(url);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = join(
    directory,
    "coffee-" + new Date().toISOString().replace(/[:.]/g, "-") + ".dump",
  );
  const partial = file + ".partial";
  await writeFile(partial, "", { flag: "wx", mode: 0o600 });
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  try {
    // Counts and archive use one database snapshot, even while normal sales continue.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = (await client.query("SELECT pg_export_snapshot() AS id"))
      .rows[0].id;
    const tables = await inventory(client);
    if (!tables.schema_migrations || !tables.products || !tables.orders)
      throw new Error(
        "The source is not a migrated Coffee Backoffice database",
      );
    const migrations = (
      await client.query(
        "SELECT name,checksum FROM public.schema_migrations ORDER BY name",
      )
    ).rows;
    await command(
      "pg_dump",
      [
        "--no-password",
        "--format=custom",
        "--schema=public",
        "--no-owner",
        "--no-acl",
        "--snapshot=" + snapshot,
        "--file=" + partial,
      ],
      env,
    );
    await client.query("COMMIT");
    await command("pg_restore", ["--list", partial], env);
    await rename(partial, file);
    const manifest = {
      format: "coffee-backup-v1",
      created_at: new Date().toISOString(),
      bytes: (await stat(file)).size,
      sha256: await digest(file),
      tables,
      migrations,
    };
    await writeFile(file + ".json", JSON.stringify(manifest, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    return { file, manifest };
  } finally {
    await client.end();
  }
}

export async function restoreDatabase(url, file, database) {
  if (!/^coffee_restore_[a-z0-9_]{1,40}$/.test(database ?? ""))
    throw new Error(
      "Use a NEW database named coffee_restore_<name> (lowercase letters, numbers, underscores)",
    );
  if (decodeURIComponent(new URL(url).pathname.slice(1)) === database)
    throw new Error("Cannot restore over the configured database");
  const manifest = JSON.parse(await readFile(file + ".json", "utf8"));
  if (
    manifest.format !== "coffee-backup-v1" ||
    manifest.sha256 !== (await digest(file)) ||
    manifest.bytes !== (await stat(file)).size
  )
    throw new Error("Backup checksum/manifest does not match; restore refused");
  const env = connection(url, database);
  await command("pg_restore", ["--list", file], env);
  const source = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 10000,
  });
  await source.connect();
  try {
    // CREATE (never DROP/--clean): an existing database fails safely, even in a race.
    await prepareBranchRole(source,manifest);
    await source.query(`CREATE DATABASE "${database}" TEMPLATE template0`);
  } finally {
    await source.end();
  }
  const freshUrl = new URL(url);
  freshUrl.pathname = "/" + database;
  const fresh = new pg.Client({
    connectionString: freshUrl.toString(),
    connectionTimeoutMillis: 10000,
  });
  await fresh.connect();
  try {
    // pg_dump --schema=public includes CREATE SCHEMA. Remove only the empty schema
    // in the database just created above; no CASCADE and no existing database path.
    await fresh.query("DROP SCHEMA public");
  } finally {
    await fresh.end();
  }
  await command(
    "pg_restore",
    [
      "--no-password",
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-acl",
      "--dbname=" + database,
      file,
    ],
    env,
  );
  const targetUrl = new URL(url);
  targetUrl.pathname = "/" + database;
  const restored = new pg.Client({
    connectionString: targetUrl.toString(),
    connectionTimeoutMillis: 10000,
  });
  await restored.connect();
  try {
    await restoreBranchGrants(restored,manifest);
    const actual = await inventory(restored);
    if (JSON.stringify(actual) !== JSON.stringify(manifest.tables))
      throw new Error(
        "Restored row counts differ from the snapshot; do not switch the application",
      );
    const migrations = (
      await restored.query(
        "SELECT name,checksum FROM public.schema_migrations ORDER BY name",
      )
    ).rows;
    if (JSON.stringify(migrations) !== JSON.stringify(manifest.migrations))
      throw new Error("Restored migration checksums differ");
    // Restored staff cookies must require a new login. Public order tracking remains intact.
    await restored.query("DELETE FROM public.sessions");
    return {
      database,
      tables: Object.keys(actual).length,
      sessions_revoked: true,
    };
  } finally {
    await restored.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (!process.env.DATABASE_URL)
      throw new Error("Set DATABASE_URL in .env first");
    const [action, file, database] = process.argv.slice(2);
    if (action === "backup") {
      const result = await backupDatabase(process.env.DATABASE_URL);
      console.log(
        `Backup verified: ${result.file}\nKeep the .dump and .dump.json together in private storage.`,
      );
    } else if (action === "restore" && file && database) {
      const result = await restoreDatabase(
        process.env.DATABASE_URL,
        resolve(file),
        database,
      );
      console.log(
        `Restored ${result.tables} tables into NEW database ${result.database}. Staff sessions revoked. Original database unchanged.`,
      );
    } else
      throw new Error(
        "Usage: npm run db:backup OR npm run db:restore -- <file.dump> coffee_restore_<name>",
      );
  } catch (error) {
    // pg error details can include connection information. Only our own fixed messages are printed.
    console.error(
      error instanceof Error && !("severity" in error)
        ? error.message
        : "Database operation failed; check connection and database permissions. No existing database was replaced.",
    );
    process.exitCode = 1;
  }
}
