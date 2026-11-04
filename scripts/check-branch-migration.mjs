import 'dotenv/config';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { connectDatabase } from '../dist/db.js';
import { migrate } from '../dist/migrate.js';
import { branchDatabase,inBranch,LEGACY_BRANCH } from '../dist/branch-context.js';

const backup=resolve(process.argv[2]??'');
const verified=JSON.parse(await readFile(backup+'.verified.json','utf8'));
const manifest=JSON.parse(await readFile(backup+'.json','utf8'));
assert(/^coffee_verify_[a-f0-9]{16}$/.test(verified.database));
assert.equal(verified.backup_sha256,manifest.sha256);
const url=new URL(process.env.DATABASE_URL);url.pathname='/'+verified.database;
const db=connectDatabase(url.toString());
try{
 const fingerprint=async()=>{
  const result={};for(const t of Object.keys(manifest.tables).filter(t=>t!=='schema_migrations')){
   result[t]=(await db.query(`SELECT count(*)::int AS n,md5(coalesce(string_agg((to_jsonb(t)-'branch_id')::text,'' ORDER BY (to_jsonb(t)-'branch_id')::text),'')) AS sha FROM "${t.replaceAll('"','""')}" t`)).rows[0];
  }return result;
 };
 const before=await fingerprint();await migrate(db);const after=await fingerprint();assert.deepEqual(after,before);
 const scoped=branchDatabase(db),other='00000000-0000-4000-8000-000000000017';
 const legacy=await inBranch({ids:[LEGACY_BRANCH],write:true,master:false},()=>scoped.query('SELECT count(*)::int AS n FROM orders'));
 const empty=await inBranch({ids:[other],write:true,master:false},()=>scoped.query('SELECT count(*)::int AS n FROM orders'));
 assert.equal(legacy.rows[0].n,before.orders.n);assert.equal(empty.rows[0].n,0);
 const role=await inBranch({ids:[other],write:false,master:false},()=>scoped.query('SELECT current_user AS name'));
 assert.equal(role.rows[0].name,'coffee_branch_runtime');
 const balances=await inBranch({ids:[other],write:false,master:false},()=>scoped.query('SELECT current_stock FROM branch_stock'));
 assert(balances.rows.every(r=>Number(r.current_stock)===0));
 const report={verified_at:new Date().toISOString(),database:verified.database,original_tables_unchanged:before,legacy_orders_visible:legacy.rows[0].n,other_branch_orders_visible:empty.rows[0].n,
  runtime_role:role.rows[0].name,new_branch_stock_zero:true,no_cleanup_executed:true};
 await mkdir('.local/multi-branch',{recursive:true});await writeFile('.local/multi-branch/native-verification.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({database:verified.database,original_tables_verified:Object.keys(before).length,legacy_orders:legacy.rows[0].n,other_branch_orders:empty.rows[0].n,runtime_role:role.rows[0].name},null,2));
}finally{await db.close();}
