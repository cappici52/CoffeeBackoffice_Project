import { test,expect } from 'vitest';
import { projectReplenishment } from '../src/shop/replenishment.js';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './database.js';
import { migrate } from '../src/migrate.js';
import { seedOwner } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { businessDate } from '../src/shop/shared.js';
test('lead-time planning distinguishes urgent gaps, expiry and orders that arrive too late',()=>{
 const plan=projectReplenishment('2026-01-01',2,2,[{date:'2026-01-01',qty:4},{date:'2026-01-02',qty:4},{date:'2026-01-03',qty:4},{date:'2026-01-04',qty:4}],
  [{qty:5,expires_on:'2026-01-02'}],[{date:'2026-01-04',qty:4}]);
 expect(plan.first_shortage_on).toBe('2026-01-02');expect(plan.order_by).toBe('2025-12-31');
 expect(plan.urgent_shortage_qty).toBe(4);expect(plan.planned_order_qty).toBe(4);expect(plan.coverage_sufficient).toBe(true);
});
test('today receipts are counted once before tomorrow demand; overdue POs are not stock',()=>{
 const plan=projectReplenishment('2026-01-01',1,2,[{date:'2026-01-02',qty:3},{date:'2026-01-03',qty:3}],[],[{date:'2026-01-01',qty:4},{date:'2025-12-31',qty:100}]);
 expect(plan.daily[0]!.projected_remaining).toBe(1);expect(plan.planned_order_qty).toBe(2);
 expect(plan.coverage_sufficient).toBe(true);
 expect(projectReplenishment('2026-01-01',30,7,[{date:'2026-01-02',qty:1}],[],[]).coverage_sufficient).toBe(false);
});
test('coverage must include every day through arrival and review, with tomorrow supported for same-day suppliers',()=>{
 const d=(date:string)=>({date,qty:1});
 const missing=projectReplenishment('2026-01-01',2,2,[d('2026-01-02'),d('2026-01-04')],[],[]);
 expect(missing.coverage_sufficient).toBe(false);
 expect(projectReplenishment('2026-01-01',0,1,[d('2026-01-02')],[],[])).toMatchObject({
  expected_arrival:'2026-01-01',demand_from:'2026-01-02',review_through:'2026-01-02',coverage_sufficient:true,planned_order_qty:1,
 });
});
test('operational planning discloses limited history and excludes simulation archives',async()=>{
 const f=await testDatabase();try{
  await migrate(f.db);await seedOwner(f.db,'planner@example.com','Test-planner-password-123');
  const app=createApp(f.db,readConfig({DATABASE_URL:'postgresql://test:test@localhost/test'}));
  const login=await request(app).post('/api/auth/login').set('Origin','http://localhost:3001').send({email:'planner@example.com',password:'Test-planner-password-123'}).expect(200);
  const cookie=login.headers['set-cookie']![0]!.split(';')[0]!,supplier=randomUUID(),category=randomUUID(),product=randomUUID(),ingredient=randomUUID(),day=businessDate();
  await f.db.query("INSERT INTO suppliers(id,name,lead_time_days) VALUES($1,'Planner fixture',0)",[supplier]);
  await f.db.query("INSERT INTO categories(id,name) VALUES($1,'Planner fixture')",[category]);
  await f.db.query("INSERT INTO products(id,category_id,name,price_satang,station) VALUES($1,$2,'Planner fixture',100,'bar')",[product,category]);
  await f.db.query("INSERT INTO ingredients(id,name,unit) VALUES($1,'Planner fixture','g')",[ingredient]);
  await f.db.query('INSERT INTO recipes(product_id) VALUES($1)',[product]);await f.db.query('INSERT INTO recipe_ingredients(product_id,ingredient_id,qty) VALUES($1,$2,1)',[product,ingredient]);
  await f.db.query('UPDATE branch_stock SET counted_at=now() WHERE ingredient_id=$1',[ingredient]);
  const run=async(simulated:boolean,limited:boolean)=>{
   const id=randomUUID();await f.db.query("INSERT INTO forecast_runs(id,generated_at,date_from,date_to,data_mode,target_basis,history_sha256,input_history,training_cohort,contains_simulated_sales) VALUES($1,now(),$2::date,$2::date+29,'actual','fulfilled_v1',$3,'[]',$4,$5)",[id,day,'a'.repeat(64),simulated?'simulation':'genuine',simulated]);
   for(let n=0;n<30;n++)await f.db.query("INSERT INTO forecast_run_points(run_id,forecast_date,product_id,predicted_qty,model_version,history_source,lead_days,diagnostics) VALUES($1,$2::date+$3::int,$4,1,'mean-7-v1','actual',$5,$6)",[id,day,n,product,n+1,JSON.stringify(limited?{reason:'limited_history_mean'}:{})]);return id;
  };
  const genuine=await run(false,true),simulated=await run(true,false),ready=await run(false,false);
  const get=(id:string)=>request(app).get(`/api/replenishment-plan?supplier_id=${supplier}&run_id=${id}&review_days=1`).set('Cookie',cookie);
  const result=await get(genuine).expect(200);expect(result.body.ready).toBe(false);expect(result.body.limited_history).toBe(true);expect(result.body.plans[0].planned_order_qty).toBe(1);
  expect((await get(simulated).expect(200)).body.reason).toBe('NO_GENUINE_FUTURE_FORECAST');
  const verified=(await get(ready).expect(200)).body;
  expect(verified.ready).toBe(true);expect(verified.plans[0].counted_at).toBeTruthy();
  await f.db.query('UPDATE products SET is_available=false WHERE id=$1',[product]);
  expect((await get(ready).expect(200)).body).toMatchObject({ready:false,plans:[]});
 }finally{await f.close();}
},30000);
