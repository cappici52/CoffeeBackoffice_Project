import 'dotenv/config';
import pg from 'pg';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { backupDatabase } from './database-backup.mjs';

// Deliberately no execute/delete mode. Produces evidence for a separate approval.
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
try {
  const root=resolve('.local/cleanup-audit',new Date().toISOString().replace(/[:.]/g,'-'));
  await mkdir(root,{recursive:true});
  const backup=await backupDatabase(process.env.DATABASE_URL);
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const counts={};for(const {tablename} of tables)counts[tablename]=(await db.query(`SELECT count(*)::int AS n FROM "${tablename.replaceAll('"','""')}"`)).rows[0].n;
  const candidates={};
  for(const table of ['orders','payments','stock_movements','day_closings','forecast_runs'])
    candidates[table]=(await db.query(`SELECT ${table==='payments'?'order_id':table==='day_closings'?'date::text':'id'},simulation_run_id FROM ${table} WHERE simulation_run_id IS NOT NULL`)).rows;
  candidates.demo_sales_daily=(await db.query("SELECT date::text,product_id FROM sales_daily WHERE source='demo'")).rows;
  const related={};
  for(const table of ['order_items','order_status_logs'])related[table]=(await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE order_id IN (SELECT id FROM orders WHERE simulation_run_id IS NOT NULL)`)).rows[0].n;
  const stock=(await db.query(counts.branches!==undefined?`SELECT b.code,s.ingredient_id AS id,i.name,i.unit,s.current_stock,
    coalesce(sum(m.qty) FILTER(WHERE m.simulation_run_id IS NULL),0) AS retained_ledger_balance,coalesce(sum(m.qty),0) AS full_ledger_balance
    FROM branch_stock s JOIN branches b ON b.id=s.branch_id JOIN ingredients i ON i.id=s.ingredient_id
    LEFT JOIN stock_movements m ON m.ingredient_id=s.ingredient_id AND m.branch_id=s.branch_id
    GROUP BY b.code,s.ingredient_id,i.name,i.unit,s.current_stock ORDER BY b.code,i.name`:`SELECT i.id,i.name,i.unit,i.current_stock,
    coalesce(sum(m.qty) FILTER(WHERE m.simulation_run_id IS NULL),0) AS retained_ledger_balance,
    coalesce(sum(m.qty),0) AS full_ledger_balance
    FROM ingredients i LEFT JOIN stock_movements m ON m.ingredient_id=i.id GROUP BY i.id ORDER BY i.name`)).rows;
  const audit={created_at:new Date().toISOString(),mode:'READ_ONLY_DRY_RUN_NO_DELETIONS',
    backup:{file:backup.file,sha256:backup.manifest.sha256,archive_list_verified:true,restore_verification:'pending'},
    counts,candidate_counts:Object.fromEntries(Object.entries(candidates).map(([k,v])=>[k,v.length])),related,
    simulation_runs:(await db.query('SELECT id,date_from::text,date_to::text,status FROM shop_simulation_runs')).rows,
    unmarked_orders:(await db.query('SELECT count(*)::int AS n FROM orders WHERE simulation_run_id IS NULL')).rows[0].n,
    seeded_receipt_evidence:(await db.query("SELECT reason,count(*)::int AS n FROM stock_movements WHERE simulation_run_id IS NULL GROUP BY reason ORDER BY count(*) DESC")).rows,
    stock_reconciliation:stock,
    decisions:['Marked simulation records are confirmed generated; delete only after approval and relationship reconciliation.',
      'Forecast archives, research datasets/results and all accounts are preserved, including potentially reused demo-seeded accounts.',
      'Unmarked orders/movements and master products/recipes are not classified synthetic by age/name/value.',
      'No customers table exists; QR tracking is stored on orders. Never export tracking tokens or credentials.',
      'No deletion executable is provided before explicit approval. Marked forecast runs remain append-only research evidence.']};
  await db.query('COMMIT');
  await writeFile(resolve(root,'candidate-records.json'),JSON.stringify(candidates,null,2),{flag:'wx',mode:0o600});
  await writeFile(resolve(root,'audit.json'),JSON.stringify(audit,null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({audit_directory:root,counts,candidate_counts:audit.candidate_counts,related,unmarked_orders:audit.unmarked_orders,backup:backup.file},null,2));
} finally {await db.end();}
