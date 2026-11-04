import 'dotenv/config';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// This command cannot execute cleanup: SELECT only, under a read-only snapshot.
if(process.argv.length>2)throw new Error('Read-only command; execution arguments are not supported');
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
try{
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const counts={};const candidates={};
 for(const table of ['orders','payments','stock_movements','day_closings']){
  const key=table==='payments'?'order_id':table==='day_closings'?'date::text':'id';
  candidates[table]=(await db.query(`SELECT ${key},branch_id,simulation_run_id FROM ${table} WHERE simulation_run_id IS NOT NULL ORDER BY branch_id,${table==='day_closings'?'date':key}`)).rows;
  counts[table]=candidates[table].length;
 }
 for(const table of ['order_items','order_status_logs'])counts[table]=(await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE order_id IN(SELECT id FROM orders WHERE simulation_run_id IS NOT NULL)`)).rows[0].n;
 candidates.demo_sales_daily=(await db.query("SELECT branch_id,date::text,product_id FROM sales_daily WHERE source='demo' ORDER BY branch_id,date,product_id")).rows;
 counts.demo_sales_daily=candidates.demo_sales_daily.length;
 candidates.derived_simulation_sales=(await db.query(`WITH computed AS(
   SELECT p.branch_id,(p.paid_at AT TIME ZONE 'Asia/Bangkok')::date AS date,i.product_id,sum(i.qty) AS qty,sum(i.qty::bigint*i.unit_price_satang) AS revenue,
    bool_and(p.simulation_run_id IS NOT NULL AND o.simulation_run_id IS NOT NULL) AS all_generated
   FROM payments p JOIN orders o ON o.id=p.order_id JOIN order_items i ON i.order_id=o.id WHERE p.status='paid' GROUP BY 1,2,3)
   SELECT d.branch_id,d.date::text,d.product_id FROM sales_daily d JOIN computed c USING(branch_id,date,product_id)
   WHERE d.source='actual' AND c.all_generated AND d.qty=c.qty AND d.revenue_satang=c.revenue ORDER BY d.branch_id,d.date,d.product_id`)).rows;
 counts.derived_simulation_sales=candidates.derived_simulation_sales.length;
 const blockers=(await db.query(`SELECT
  (SELECT count(*) FROM payments p JOIN orders o ON o.id=p.order_id WHERE p.simulation_run_id IS DISTINCT FROM o.simulation_run_id)::int AS payment_provenance_mismatch,
  (SELECT count(*) FROM stock_movements m JOIN orders o ON o.id=m.ref_order_id WHERE m.simulation_run_id IS DISTINCT FROM o.simulation_run_id)::int AS movement_provenance_mismatch,
  (SELECT count(*) FROM stock_movements m JOIN orders o ON o.id=m.ref_order_id WHERE m.simulation_run_id IS NULL AND o.simulation_run_id IS NOT NULL)::int AS unmarked_movements_referencing_candidates`)).rows[0];
 const balances=(await db.query(`SELECT b.code,s.ingredient_id,i.name,i.unit,s.current_stock,
  coalesce(sum(m.qty) FILTER(WHERE m.simulation_run_id IS NULL),0) AS after_marked_cleanup,
  (SELECT balance_after FROM stock_movements t WHERE t.branch_id=s.branch_id AND t.ingredient_id=s.ingredient_id AND t.simulation_run_id IS NULL ORDER BY t.created_at DESC,t.id DESC LIMIT 1) AS retained_last_balance,
  coalesce(sum(m.qty) FILTER(WHERE m.simulation_run_id IS NULL AND m.reason<>'ยอดตั้งต้นข้อมูลตัวอย่าง'),0) AS after_also_removing_demo_opening
  FROM branch_stock s JOIN branches b ON b.id=s.branch_id JOIN ingredients i ON i.id=s.ingredient_id
  LEFT JOIN stock_movements m ON m.branch_id=s.branch_id AND m.ingredient_id=s.ingredient_id GROUP BY b.code,s.branch_id,s.ingredient_id,i.name,i.unit,s.current_stock ORDER BY b.code,i.name`)).rows;
 const preserved={orders:(await db.query('SELECT count(*)::int AS n FROM orders WHERE simulation_run_id IS NULL')).rows[0].n,
  payments:(await db.query('SELECT count(*)::int AS n FROM payments WHERE simulation_run_id IS NULL')).rows[0].n,
  unmarked_stock_movements:(await db.query('SELECT count(*)::int AS n FROM stock_movements WHERE simulation_run_id IS NULL')).rows[0].n,
  users:(await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n,
  forecast_runs:(await db.query('SELECT count(*)::int AS n FROM forecast_runs')).rows[0].n,
  research_datasets:(await db.query('SELECT count(*)::int AS n FROM research_datasets')).rows[0].n};
 blockers.retained_stock_snapshot_mismatch=balances.filter(b=>b.retained_last_balance!==null&&Number(b.retained_last_balance)!==Number(b.after_marked_cleanup)).length;
 const research={format:'synthetic-workflow-preservation-v1',label:'SYNTHETIC_WORKFLOW_ARCHIVE_NOT_PRODUCTION_SALES',captured_at:new Date().toISOString(),
  legacy_demo_history:(await db.query("SELECT branch_id,date::text,product_id,qty,revenue_satang,source FROM sales_daily WHERE source='demo' ORDER BY branch_id,date,product_id")).rows,
  fulfilled_sales:(await db.query(`SELECT o.branch_id,(o.completed_at AT TIME ZONE 'Asia/Bangkok')::date::text AS date,i.product_id,sum(i.qty) AS qty,sum(i.qty::bigint*i.unit_price_satang) AS revenue_satang
   FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.simulation_run_id IS NOT NULL AND o.status='completed' GROUP BY 1,2,3 ORDER BY 1,2,3`)).rows,
  simulation_runs:(await db.query('SELECT to_jsonb(r) AS row FROM shop_simulation_runs r ORDER BY id')).rows.map(r=>r.row),
  simulation_products:(await db.query('SELECT * FROM shop_simulation_products ORDER BY run_id,product_id')).rows,
  simulation_closings:(await db.query('SELECT branch_id,date::text,simulation_run_id,summary FROM day_closings WHERE simulation_run_id IS NOT NULL ORDER BY branch_id,date')).rows,
  issued_runs:(await db.query('SELECT to_jsonb(r) AS row FROM forecast_runs r ORDER BY generated_at,id')).rows.map(r=>r.row),
  issued_points:(await db.query('SELECT to_jsonb(p) AS row FROM forecast_run_points p ORDER BY run_id,forecast_date,product_id')).rows.map(r=>r.row),
  legacy_forecast_cache:(await db.query('SELECT to_jsonb(f) AS row FROM forecasts f ORDER BY branch_id,forecast_date,product_id')).rows.map(r=>r.row),
  note:'Preservation export only. Original predictions and input snapshots retained; no refitting, evaluation or relabeling as genuine sales. Public Replay datasets remain unchanged in their separate tables.'};
 const researchRaw=JSON.stringify(research);
 const report={generated_at:new Date().toISOString(),mode:'READ_ONLY_NO_EXECUTE_MODE',execution_status:Object.values(blockers).some(v=>v>0)?'BLOCKED_PROVENANCE_OR_STOCK_REVIEW':'BLOCKED_PENDING_EXPLICIT_DELETION_APPROVAL',negative_balances_if_demo_opening_removed:balances.filter(b=>Number(b.after_also_removing_demo_opening)<0).length,user_decision:'Preserve nine unmarked orders and related transactions; retain ten legacy demo opening receipts with pending-count labeling. Proposed balance is the retained ledger, not a verified physical count.',candidate_counts:counts,blockers,
  research_preservation:{file:'synthetic-workflow-research-archive.json',sha256:createHash('sha256').update(researchRaw).digest('hex'),legacy_demo_rows:research.legacy_demo_history.length,fulfilled_product_days:research.fulfilled_sales.length,issued_runs:research.issued_runs.length,issued_points:research.issued_points.length},
  preserved,projected_balances:balances,
  policy:['No destructive SQL was executed, including in backup verification databases.',
   'Potential removal order after separate approval: marked order logs/items/payments/movements/closings, marked orders, explicitly demo and exactly reconciled generated sales summaries.',
   'Keep all users, master data, dining tables, bank QR settings, simulation provenance, immutable forecast/research archives and unmarked transactions.',
   'Keep forecasting caches/jobs and all issued archives in this cleanup; archived simulation predictions remain labeled as such.',
   'Proposed stock update after approval restores the retained ledger balances shown here; preserve opening receipts and mark them pending physical count as the user selected.',
   'Ten demo opening receipts are withheld from the executable plan: removing them produces negative retained-ledger balances. Physical inventory/cutover policy requires separate approval.',
   'Do not rewrite retained historical movement snapshots. An approved physical count/cutover must use an explicit audited reconciliation, retaining original quantities and provenance.',
   'Before execution create a fresh verified backup, compare candidate IDs/counts/hash and stop if provenance or balances changed.'],
  candidate_sha256:createHash('sha256').update(JSON.stringify(candidates)).digest('hex')};
 report.plan_sha256=createHash('sha256').update(JSON.stringify({candidate_sha256:report.candidate_sha256,preserved,balances,blockers,stock_policy:report.user_decision})).digest('hex');
 await db.query('COMMIT');
 const root=resolve('.local/cleanup-dry-run',new Date().toISOString().replace(/[:.]/g,'-'));await mkdir(root,{recursive:true});
 await writeFile(resolve(root,'candidate-records.json'),JSON.stringify(candidates,null,2),{flag:'wx',mode:0o600});
 await writeFile(resolve(root,'synthetic-workflow-research-archive.json'),researchRaw,{flag:'wx',mode:0o600});
 await writeFile(resolve(root,'report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
 const review=['# Proposed cleanup — approval required','',
  'No deletion or stock update has executed. Keep nine unmarked orders, seven payments, all accounts and forecasting/research data. Retain ten demo opening receipts, labeled pending physical count, as the user selected.','',
  '| Generated group | Candidate rows |','|---|---:|',...Object.entries(counts).map(([k,v])=>`| ${k} | ${v} |`),'',
  '## Proposed stock after removing marked movements','',
  'Restore the retained ledger; these quantities are not verified physical counts. Retained historical snapshots and quantities remain unchanged. Rows with no balance change need no update.','',
  '| Branch | Ingredient | Current | Proposed retained balance | Unit |','|---|---|---:|---:|---|',
  ...balances.filter(b=>Number(b.current_stock)!==Number(b.after_marked_cleanup)).map(b=>`| ${b.code} | ${b.name} | ${b.current_stock} | ${b.after_marked_cleanup} | ${b.unit} |`),'',
  'Provenance and retained-snapshot mismatch counts: '+JSON.stringify(blockers),
  'Candidate manifest SHA-256: '+report.candidate_sha256,
  'Reviewed plan SHA-256 (including retained counts and stock projections): '+report.plan_sha256,
  'Research preservation SHA-256: '+report.research_preservation.sha256,'',
  'See candidate-records.json for exact IDs, report.json for all branch projections, and synthetic-workflow-research-archive.json for preserved outcomes/predictions. Keep all immutable archives and public Replay datasets in the application database.','',
  'Execution remains blocked until explicit deletion approval. Recheck this manifest and create a fresh verified backup before an approved transaction.'];
 await writeFile(resolve(root,'review.md'),review.join('\n'),{flag:'wx',mode:0o600});
 console.log(JSON.stringify({directory:root,candidate_counts:counts,preserved,blockers,candidate_sha256:report.candidate_sha256},null,2));
}finally{await db.end();}
