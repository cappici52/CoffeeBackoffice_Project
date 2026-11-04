import 'dotenv/config';
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// Explicit one-plan execution, not a general reset or a startup operation.
const [directory, backup, approval] = process.argv.slice(2);
assert.equal(approval, '--approved-items-1-13');
const root = resolve(directory), file = resolve(backup);
assert(root.startsWith(resolve('.local/cleanup-dry-run') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/')));
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const plan = await json(root + '/report.json'), candidates = await json(root + '/candidate-records.json');
const manifest = await json(file + '.json'), verified = await json(file + '.verified.json');
const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(await readFile(file)), manifest.sha256);
assert.equal(verified.backup_sha256, manifest.sha256);
assert(verified.all_row_counts_match && verified.migration_checksums_match);
assert.equal(sha(JSON.stringify(candidates)), plan.candidate_sha256);
assert.equal(plan.candidate_sha256, '6f03cd2bcfa2565d5e7dd5aa3d70dcdac54dc409d58b06febe5a2fe4e0356269');
assert(Object.values(plan.blockers).every(n => n === 0));
assert.equal(plan.preserved.orders, 9);
assert.equal(sha(await readFile(root + '/synthetic-workflow-research-archive.json')), plan.research_preservation.sha256);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query('BEGIN');
  await db.query("SET LOCAL lock_timeout='10s'");
  const tables = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => r.tablename);
  // Freeze source tables together; abort rather than race a sale or a worker.
  for (const t of tables) await db.query(`LOCK TABLE "${t}" IN SHARE ROW EXCLUSIVE MODE`);
  const mutable = new Set(['orders','payments','order_items','order_status_logs','stock_movements','day_closings','sales_daily','branch_stock','ingredients']);
  const fingerprint = async (table, filter = '', omit = '') => (await db.query(`SELECT md5(coalesce(string_agg(row::text,'' ORDER BY row::text),'')) AS hash FROM (SELECT to_jsonb(t) ${omit} AS row FROM "${table}" t ${filter}) s`)).rows[0].hash;
  const preserved = {};
  for (const t of tables.filter(t => !mutable.has(t))) preserved[t] = await fingerprint(t);
  for (const t of ['orders','payments','stock_movements','day_closings']) preserved[t] = await fingerprint(t, 'WHERE simulation_run_id IS NULL');
  for (const t of ['order_items','order_status_logs']) preserved[t] = await fingerprint(t, 'WHERE order_id IN(SELECT id FROM orders WHERE simulation_run_id IS NULL)');
  preserved.ingredients = await fingerprint('ingredients', '', "- 'current_stock' - 'version'");
  for (const table of ['orders','payments','stock_movements','day_closings']) {
    const key = table === 'payments' ? 'order_id' : table === 'day_closings' ? 'date::text' : 'id';
    const rows = (await db.query(`SELECT ${key},branch_id,simulation_run_id FROM ${table} WHERE simulation_run_id IS NOT NULL ORDER BY branch_id,${table === 'day_closings' ? 'date' : key}`)).rows;
    assert.deepEqual(rows, candidates[table], 'Candidate set changed: ' + table);
  }
  const ids = candidates.orders.map(r => r.id);
  for (const row of candidates.derived_simulation_sales) {
    const check = await db.query(`SELECT d.product_id FROM sales_daily d JOIN (
      SELECT sum(i.qty) qty,sum(i.qty::bigint*i.unit_price_satang) revenue,
        bool_and(p.simulation_run_id IS NOT NULL AND o.simulation_run_id IS NOT NULL) generated
      FROM payments p JOIN orders o ON o.id=p.order_id JOIN order_items i ON i.order_id=o.id
      WHERE p.status='paid' AND p.branch_id=$1 AND (p.paid_at AT TIME ZONE 'Asia/Bangkok')::date=$2 AND i.product_id=$3
    ) c ON c.generated AND d.qty=c.qty AND d.revenue_satang=c.revenue
    WHERE d.branch_id=$1 AND d.date=$2 AND d.product_id=$3 AND d.source='actual'`, [row.branch_id,row.date,row.product_id]);
    assert.equal(check.rowCount, 1, 'Generated summary provenance changed');
  }
  assert.equal(Number((await db.query('SELECT count(*) FROM stock_movements WHERE ref_order_id=ANY($1::uuid[]) AND simulation_run_id IS NULL', [ids])).rows[0].count), 0);
  for (const t of ['order_status_logs','order_items']) {
    const removed = await db.query(`DELETE FROM ${t} WHERE order_id=ANY($1::uuid[]) RETURNING 1`, [ids]);
    assert.equal(removed.rowCount, plan.candidate_counts[t]);
  }
  for (const [t,key] of [['payments','order_id'],['stock_movements','id']]) {
    const removed = await db.query(`DELETE FROM ${t} WHERE ${key}=ANY($1::uuid[]) AND simulation_run_id IS NOT NULL RETURNING 1`, [candidates[t].map(r => r[key])]);
    assert.equal(removed.rowCount, plan.candidate_counts[t]);
  }
  for (const row of candidates.day_closings) {
    const removed = await db.query('DELETE FROM day_closings WHERE branch_id=$1 AND date=$2 AND simulation_run_id=$3 RETURNING 1', [row.branch_id,row.date,row.simulation_run_id]);
    assert.equal(removed.rowCount, 1);
  }
  const removed = await db.query('DELETE FROM orders WHERE id=ANY($1::uuid[]) AND simulation_run_id IS NOT NULL RETURNING 1', [ids]);
  assert.equal(removed.rowCount, plan.candidate_counts.orders);
  for (const [group,source] of [['demo_sales_daily','demo'],['derived_simulation_sales','actual']])
    for (const row of candidates[group]) {
      const deleted = await db.query('DELETE FROM sales_daily WHERE branch_id=$1 AND date=$2 AND product_id=$3 AND source=$4 RETURNING 1', [row.branch_id,row.date,row.product_id,source]);
      assert.equal(deleted.rowCount, 1);
    }
  // Restore retained ledger totals only; never rewrite historical movement snapshots.
  for (const b of plan.projected_balances) {
    const current = (await db.query('SELECT s.current_stock,(SELECT coalesce(sum(m.qty),0) FROM stock_movements m WHERE m.branch_id=s.branch_id AND m.ingredient_id=s.ingredient_id) AS retained FROM branch_stock s JOIN branches br ON br.id=s.branch_id WHERE br.code=$1 AND s.ingredient_id=$2', [b.code,b.ingredient_id])).rows[0];
    assert.equal(Number(current.current_stock), Number(b.current_stock));
    assert.equal(Number(current.retained), Number(b.after_marked_cleanup));
    assert(Number(current.retained) >= 0);
    await db.query('UPDATE branch_stock SET current_stock=$1,version=version+1 WHERE ingredient_id=$2 AND branch_id=(SELECT id FROM branches WHERE code=$3) AND current_stock<>$1', [current.retained,b.ingredient_id,b.code]);
  }
  for (const [t,hash] of Object.entries(preserved)) {
    const filter = ['orders','payments','stock_movements','day_closings'].includes(t) ? 'WHERE simulation_run_id IS NULL' : ['order_items','order_status_logs'].includes(t) ? 'WHERE order_id IN(SELECT id FROM orders WHERE simulation_run_id IS NULL)' : '';
    assert.equal(await fingerprint(t, filter, t === 'ingredients' ? "- 'current_stock' - 'version'" : ''), hash, 'Preserved data changed: ' + t);
  }
  assert.equal(Number((await db.query('SELECT count(*) FROM orders')).rows[0].count), 9);
  const receipt = { executed_at: new Date().toISOString(), approval: 'User requested items 1–13', backup_sha256: manifest.sha256, candidate_sha256: plan.candidate_sha256, removed: plan.candidate_counts, preserved_hashes: preserved, physical_count_verified: false };
  await writeFile(root + '/execution-receipt.json', JSON.stringify({ ...receipt, committed: false }, null, 2), { flag: 'wx', mode: 0o600 });
  await db.query('COMMIT');
  await writeFile(root + '/execution-receipt.json', JSON.stringify({ ...receipt, committed: true }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ committed: true, remaining_orders: 9, preserved_groups: Object.keys(preserved).length, receipt: root + '/execution-receipt.json' }));
} catch (e) { await db.query('ROLLBACK'); throw e; }
finally { await db.end(); }
