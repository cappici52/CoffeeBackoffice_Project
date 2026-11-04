import { createHash,randomUUID } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { test,expect } from 'vitest';
import { testDatabase } from './database.js';
import { migrate } from '../src/migrate.js';
import { LEGACY_BRANCH } from '../src/branch-context.js';

test('migration preserves legacy stock, actors and append-only forecast payloads without arbitrary redistribution',async()=>{
 const f=await testDatabase();try{
  await f.db.query('CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  for(const name of (await readdir('migrations')).filter(x=>x.endsWith('.sql')&&x<'016').sort()){
   const text=await readFile('migrations/'+name,'utf8');await f.db.query(text);
   await f.db.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)',[name,createHash('sha256').update(text).digest('hex')]);
  }
  const actor=randomUUID(),ingredient=randomUUID(),run=randomUUID(),history=[{date:'2026-01-01',qty:12}];
  await f.db.query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Existing','existing@example.com','test-hash','cashier')",[actor]);
  await f.db.query("INSERT INTO ingredients(id,name,unit,current_stock) VALUES($1,'Existing stock','g',25)",[ingredient]);
  await f.db.query("INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history,created_by) VALUES($1,now(),'2026-01-02','2026-01-02','actual','fulfilled_v1',$2,$3,$4)",[run,'a'.repeat(64),JSON.stringify(history),actor]);
  await migrate(f.db);await migrate(f.db);
  const saved=(await f.db.query('SELECT branch_id,input_history FROM forecast_runs WHERE id=$1',[run])).rows[0];
  expect(saved).toEqual({branch_id:LEGACY_BRANCH,input_history:history});
  expect((await f.db.query('SELECT branch_id FROM user_branches WHERE user_id=$1',[actor])).rows).toEqual([{branch_id:LEGACY_BRANCH}]);
  const balances=(await f.db.query('SELECT branch_id,current_stock FROM branch_stock WHERE ingredient_id=$1',[ingredient])).rows;
  expect(balances).toHaveLength(3);expect(Number(balances.find(x=>x.branch_id===LEGACY_BRANCH)?.current_stock)).toBe(25);
  expect(balances.filter(x=>x.branch_id!==LEGACY_BRANCH).every(x=>Number(x.current_stock)===0)).toBe(true);
  await expect(f.db.query("UPDATE forecast_runs SET input_history='[]' WHERE id=$1",[run])).rejects.toThrow();
 }finally{await f.close();}
},30000);
