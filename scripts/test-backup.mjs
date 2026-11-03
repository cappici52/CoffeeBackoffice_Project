import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { backupDatabase, restoreDatabase } from "./database-backup.mjs";

// Creates and drops only these generated databases; never migrates or seeds the shop.
const suffix = randomUUID().replaceAll("-", "");
const sourceName = "coffee_restore_fixture_" + suffix;
const targetName = "coffee_restore_test_" + suffix;
const root = new pg.Client({ connectionString: process.env.DATABASE_URL });
const sourceUrl = new URL(process.env.DATABASE_URL);
sourceUrl.pathname = "/" + sourceName;
await root.connect();
let source;
let target;
try {
  await root.query(`CREATE DATABASE "${sourceName}" TEMPLATE template0`);
  for (const script of ["migrate", "seed", "demo"]) {
    const result = spawnSync(process.execPath, [`dist/${script}.js`], {
      windowsHide: true,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: sourceUrl.toString(),
        SEED_OWNER_EMAIL: "backup@example.com",
        SEED_OWNER_PASSWORD: randomBytes(20).toString("hex"),
      },
    });
    assert.equal(result.status, 0, `Isolated backup fixture ${script} failed`);
  }
  source = new pg.Client({ connectionString: sourceUrl.toString() });
  await source.connect();
  const actor = (await source.query("SELECT id FROM users ORDER BY id LIMIT 1"))
    .rows[0].id;
  const photo = await readFile("client/public/menu/latte.jpg");
  // Backup must preserve binary contents too; this bytea fixture need not be a serving WebP.
  await source.query(
    "INSERT INTO menu_images(id,hash,data,width,height,created_by) VALUES($1,$2,$3,640,480,$4)",
    [randomUUID(), "a".repeat(64), photo, actor],
  );
  await source.query(
    "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    ["b".repeat(64), actor],
  );
  const runId = randomUUID();
  const menu = (
    await source.query("SELECT id FROM products ORDER BY id LIMIT 1")
  ).rows[0].id;
  await source.query(
    "INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history,created_by) VALUES($1,now(),current_date+1,current_date+1,'actual','fulfilled_v1',$2,'[]',$3)",
    [runId, "c".repeat(64), actor],
  );
  await source.query(
    "INSERT INTO forecast_run_points(run_id,forecast_date,product_id,predicted_qty,model_version,history_source,lead_days) VALUES($1,current_date+1,$2,12,'ses-v1','actual',1)",
    [runId, menu],
  );
  const directory = await mkdtemp(join(tmpdir(), "coffee-backup-check-"));
  const { file, manifest } = await backupDatabase(
    sourceUrl.toString(),
    directory,
  );
  assert.equal(manifest.tables.menu_images, "1");
  assert.equal(manifest.tables.products, "8");
  assert.equal(manifest.tables.forecast_runs, "1");
  const result = await restoreDatabase(sourceUrl.toString(), file, targetName);
  assert.equal(result.sessions_revoked, true);
  const targetUrl = new URL(sourceUrl);
  targetUrl.pathname = "/" + targetName;
  target = new pg.Client({ connectionString: targetUrl.toString() });
  await target.connect();
  assert.equal(
    (
      await target.query(
        "SELECT predicted_qty FROM forecast_run_points WHERE run_id=$1",
        [runId],
      )
    ).rows[0].predicted_qty,
    "12.000",
  );
  await assert.rejects(
    target.query(
      "UPDATE forecast_run_points SET predicted_qty=0 WHERE run_id=$1",
      [runId],
    ),
  );
  assert.deepEqual(
    Buffer.from(
      (await target.query("SELECT data FROM menu_images")).rows[0].data,
    ),
    photo,
  );
  assert.equal(
    (await target.query("SELECT count(*)::int n FROM sessions")).rows[0].n,
    0,
  );
  assert.equal(
    (await source.query("SELECT count(*)::int n FROM sessions")).rows[0].n,
    1,
  );
  await assert.rejects(
    restoreDatabase(sourceUrl.toString(), file, sourceName),
    /configured database/,
  );
  await assert.rejects(
    restoreDatabase(sourceUrl.toString(), file, "coffee_backoffice"),
    /NEW database/,
  );
  await assert.rejects(restoreDatabase(sourceUrl.toString(), file, targetName));
  await assert.rejects(
    restoreDatabase(
      sourceUrl.toString(),
      file,
      'coffee_restore_x";DROP DATABASE postgres;--',
    ),
    /NEW database/,
  );
  const broken = join(directory, "corrupt.dump");
  await writeFile(broken, "broken archive");
  await writeFile(broken + ".json", JSON.stringify(manifest));
  await assert.rejects(
    restoreDatabase(
      sourceUrl.toString(),
      broken,
      "coffee_restore_unused_" + suffix,
    ),
    /checksum/,
  );
  assert.equal(
    (await target.query("SELECT count(*)::int n FROM products")).rows[0].n,
    8,
  );
  console.log(
    "Backup/restore passed: snapshot counts, checksums, binary photos, revoked restored sessions, corruption rejection, existing/source database protection.",
  );
} finally {
  await source?.end();
  await target?.end();
  for (const name of [targetName, sourceName]) {
    assert.match(name, /^coffee_restore_(test|fixture)_[a-f0-9]{32}$/);
    await root.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
  await root.end();
}
