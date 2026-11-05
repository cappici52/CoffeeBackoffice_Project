import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { availableParallelism,platform } from 'node:os';
import pg from 'pg';
import { connectDatabase } from '../dist/db.js';
import { migrate } from '../dist/migrate.js';
import { seedOwner } from '../dist/seed.js';
import { createApp } from '../dist/app.js';
import { readConfig } from '../dist/config.js';
import { assertDemoIsolation } from '../dist/demo-isolation.js';

assert(process.argv.includes('--isolated'),'Explicit --isolated is required');
const schema='e2e_'+randomUUID().replaceAll('-','');
const root=new pg.Client({connectionString:process.env.DATABASE_URL});await root.connect();
const sourceProof=async()=> (await root.query(`SELECT (SELECT count(*) FROM public.orders)::text AS orders,
 (SELECT count(*) FROM public.payments)::text AS payments,
 (SELECT md5(string_agg(to_jsonb(s)::text,'' ORDER BY branch_id,ingredient_id)) FROM public.branch_stock s) AS stock_hash`)).rows[0];
const before=await sourceProof();await root.query(`CREATE SCHEMA ${schema}`);
const url=new URL(process.env.DATABASE_URL);url.searchParams.set('options','-csearch_path='+schema);assertDemoIsolation(url.toString(),'test');
const db=connectDatabase(url.toString());let server;
try{
 await migrate(db);const password=randomBytes(24).toString('hex');await seedOwner(db,'benchmark@example.com',password);
 const config=readConfig({...process.env,NODE_ENV:'test',DATABASE_URL:url.toString(),APP_ORIGIN:'http://localhost:3001'});
 const app=createApp(db,config);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;let cookie='';
 const call=async(path,method='GET',body)=>{
  const start=performance.now(),r=await fetch(base+'/api'+path,{method,headers:{Origin:config.APP_ORIGIN,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  if(path==='/auth/login')cookie=r.headers.get('set-cookie').split(';')[0];
  const value=r.status===204?null:await r.json();return {status:r.status,value,ms:performance.now()-start};
 };
 const post=async(path,body,status=201)=>{const r=await call(path,'POST',body);assert.equal(r.status,status,`${path}: ${r.value?.error}`);return r.value;};
 await post('/auth/login',{email:'benchmark@example.com',password},200);
 const category=(await post('/categories',{name:'Benchmark fixture'})).category.id;
 const ingredient=(await post('/ingredients',{name:'Benchmark fixture units',unit:'ชิ้น',reorder_point:0,cost_satang:1})).id;
 const product=(await post('/products',{category_id:category,name:'Benchmark fixture coffee',price_satang:100})).product.id;
 assert.equal((await call('/recipes/'+product,'PUT',{expected_version:0,ingredients:[{ingredient_id:ingredient,qty:1}],steps:[]})).status,204);
 await post('/stock-movements',{ingredient_id:ingredient,type:'receipt',qty:2,reason:'Isolated concurrency fixture'},204);
 const batch=async(n,concurrency,work)=>{let next=0;const rows=[];await Promise.all(Array.from({length:concurrency},async()=>{while(next<n){const i=next++;rows.push(await work(i));}}));return rows;};
 const summary=rows=>{const ms=rows.map(r=>r.ms).sort((a,b)=>a-b);return {requests:rows.length,statuses:Object.fromEntries([...new Set(rows.map(r=>r.status))].map(s=>[s,rows.filter(r=>r.status===s).length])),p50_ms:ms[Math.floor(ms.length*.5)],p95_ms:ms[Math.min(ms.length-1,Math.floor(ms.length*.95))],max_ms:ms.at(-1)};};
 const read=await batch(100,10,()=>call('/catalog'));assert(read.every(r=>r.status===200));
 const order=key=>({request_key:key,type:'takeaway',payment_method:'cash',items:[{product_id:product,qty:1}]});
 const writes=await batch(30,10,()=>call('/orders','POST',order(randomUUID())));
 assert.equal(writes.filter(r=>r.status===201).length,2);assert.equal(writes.filter(r=>r.status===409).length,28);
 await post('/stock-movements',{ingredient_id:ingredient,type:'receipt',qty:10,reason:'Isolated duplicate-request fixture'},204);
 const key=randomUUID(),duplicate=await batch(20,10,()=>call('/orders','POST',order(key)));
 assert(duplicate.every(r=>r.status===201));assert.equal(new Set(duplicate.map(r=>r.value.order.id)).size,1);
 const ledger=(await db.query('SELECT current_stock FROM branch_stock WHERE ingredient_id=$1 AND branch_id=coffee_current_branch()',[ingredient])).rows[0];assert.equal(Number(ledger.current_stock),9);
 const count=(await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n;assert.equal(count,3);
 const after=await sourceProof();assert.deepEqual(after,before);
 const report={measured_at:new Date().toISOString(),platform:platform(),node:process.version,cpu_parallelism:availableParallelism(),isolated_schema:schema,concurrency:10,read_burst:summary(read),last_two_units:summary(writes),same_request_recovery:summary(duplicate),final_fixture_stock:Number(ledger.current_stock),fixture_orders:count,operational_source_unchanged:true,limits:['Local machine only, not a production capacity/SLA claim.','Expected 409s are stock protection, not successful sales.','No real customers, operational orders or physical stock counts were generated.','Test schema retained; no DROP or cleanup of existing data.']};
 const directory=resolve('.local/benchmarks',new Date().toISOString().replaceAll(':','-'));await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(report,null,2));
}finally{if(server)await new Promise(r=>server.close(r));await db.close();await root.end();}
