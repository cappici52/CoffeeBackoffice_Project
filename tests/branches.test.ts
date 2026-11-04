import { randomUUID } from 'node:crypto';
import { beforeAll,afterAll,test,expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { readConfig } from '../src/config.js';
import { seedOwner } from '../src/seed.js';
import { LEGACY_BRANCH,branchDatabase,inBranch } from '../src/branch-context.js';
import { history } from '../src/shop/forecasts.js';
import { dataset } from '../src/shop/forecast-data.js';
import { newToken } from '../src/security.js';
import { businessDate } from '../src/shop/shared.js';
import { testDatabase } from './database.js';

const origin='http://localhost:3001',password='Branch-test-password1',a=LEGACY_BRANCH,b='00000000-0000-4000-8000-000000000017';
let fixture:Awaited<ReturnType<typeof testDatabase>>,app:ReturnType<typeof createApp>,owner:string,staff:string,manager:string,product:string,ingredient:string,newBranch:string;
const send=(method:'get'|'post'|'put'|'patch',path:string,branch=a,cookie=owner)=>request(app)[method]('/api'+path).set('Origin',origin).set('Cookie',cookie).set('X-Branch-Id',branch);
const order=()=>({request_key:randomUUID(),type:'takeaway',payment_method:'cash',items:[{product_id:product,qty:1}]});
const stock=async(branch:string)=>Number((await send('get','/ingredients',branch).expect(200)).body.ingredients.find((i:any)=>i.id===ingredient).current_stock);
beforeAll(async()=>{
 fixture=await testDatabase();await migrate(fixture.db);await seedOwner(fixture.db,'owner@example.com',password);
 app=createApp(fixture.db,readConfig({DATABASE_URL:'postgresql://test:test@localhost/test'}));
 const login=async(email:string)=>(await request(app).post('/api/auth/login').set('Origin',origin).send({email,password}).expect(200)).headers['set-cookie']![0]!.split(';')[0]!;
 owner=await login('owner@example.com');
 for(const role of ['cashier','manager'])await send('post','/users').send({name:role,email:role+'@example.com',password,role}).expect(201);
 staff=await login('cashier@example.com');manager=await login('manager@example.com');
 const category=(await send('post','/categories').send({name:'Coffee'}).expect(201)).body.category.id;
 ingredient=(await send('post','/ingredients').send({name:'Beans',unit:'g',cost_satang:10,reorder_point:20}).expect(201)).body.id;
 product=(await send('post','/products').send({name:'Coffee',category_id:category,price_satang:5000}).expect(201)).body.product.id;
 await send('put','/recipes/'+product).send({expected_version:0,ingredients:[{ingredient_id:ingredient,qty:10}],steps:[]}).expect(204);
 for(const [branch,qty] of [[a,200],[b,300]] as const)await send('post','/stock-movements',branch).send({ingredient_id:ingredient,type:'receipt',qty,reason:'Test opening'}).expect(204);
},30000);
afterAll(async()=>fixture?.close());

test('three initial branches, unlimited creation, editable details and zero starting balances',async()=>{
 expect((await send('get','/branches').expect(200)).body.branches).toHaveLength(3);
 newBranch=(await send('post','/branches').send({name:'Fourth',code:'FOUR',address:'Test address',phone:'123'}).expect(201)).body.id;
 expect(await stock(newBranch)).toBe(0);
 const branch=(await send('get','/branches').expect(200)).body.branches.find((x:any)=>x.id===newBranch);
 await send('patch','/branches/'+newBranch).send({name:'Fourth edited',code:'FOUR',address:'Test address',phone:'123',is_active:true,expected_version:branch.version}).expect(204);
});
test('staff and managers cannot select or mutate unassigned branches',async()=>{
 expect((await send('get','/branches',a,staff)).body.branches.map((x:any)=>x.id)).toEqual([a]);
 await send('get','/orders',b,staff).expect(403);await send('get','/orders','all',staff).expect(403);
 await send('post','/branches',a,manager).send({name:'No',code:'NO'}).expect(403);
 await send('post','/orders',b,manager).send(order()).expect(403);
 const report=await send('get',`/reports?date_from=${businessDate()}&date_to=${businessDate()}`,'all',manager).expect(200);
 expect(report.body.branches.map((x:any)=>x.id)).toEqual([a]);
});
test('branch override changes price and availability without duplicating master products',async()=>{
 await send('put','/branch-products/'+product,b).send({price_satang:7000,is_available:false,expected_version:0}).expect(204);
 await send('post','/orders',b).send(order()).expect(409);
 await send('put','/branch-products/'+product,b).send({price_satang:7000,is_available:true,expected_version:1}).expect(204);
 const catalogs=await Promise.all([send('get','/catalog',a),send('get','/catalog',b)]);
 expect(catalogs[0].body.products[0].price_satang).toBe(5000);expect(catalogs[1].body.products[0].price_satang).toBe(7000);
});
test('orders, receipt details, payments, KDS and ingredient deductions are isolated',async()=>{
 const response=await send('post','/orders',b).send(order()).expect(201),id=response.body.order.id;
 expect(response.body.order.branch_id).toBe(b);expect(await stock(b)).toBe(290);expect(await stock(a)).toBe(200);
 await send('get','/orders/'+id,a).expect(404);await send('post','/orders/'+id+'/pay',a).send({method:'cash'}).expect(404);
 expect((await send('get','/kds?station=all',a).expect(200)).body.orders).toHaveLength(0);
 expect((await send('get','/orders',a).expect(200)).body.total).toBe(0);
 await send('post','/orders',a,staff).send(order()).expect(201);expect(await stock(a)).toBe(190);expect(await stock(b)).toBe(290);
 const movement=await fixture.db.query('SELECT branch_id FROM stock_movements WHERE ref_order_id=$1',[id]);expect(movement.rows.every(x=>x.branch_id===b)).toBe(true);
});
test('reports sum stored sales by branch, and new branches display empty operational data',async()=>{
 const query=`/reports?date_from=${businessDate()}&date_to=${businessDate()}`;
 const combined=(await send('get',query,'all').expect(200)).body;
 expect(Number(combined.summary.revenue_satang)).toBe(12000);expect(combined.summary.orders).toBe(2);
 expect(combined.branches.reduce((n:number,x:any)=>n+Number(x.revenue_satang),0)).toBe(12000);
 const empty=(await send('get',query,newBranch).expect(200)).body;expect(Number(empty.summary.revenue_satang)).toBe(0);expect(empty.products).toHaveLength(0);
 await send('post','/orders','all').send(order()).expect(400);
});
test('membership changes take effect on the next request; inactive branches reject operational writes',async()=>{
 const employees=(await send('get','/branches/'+b+'/employees').expect(200)).body.employees;
 const employee=employees.find((x:any)=>x.role==='cashier');
 await send('put',`/branches/${b}/employees/${employee.id}`).send({assigned:true}).expect(204);
 await send('get','/orders',b,staff).expect(200);
 await send('put',`/branches/${b}/employees/${employee.id}`).send({assigned:false}).expect(204);
 await send('get','/orders',b,staff).expect(403);
 const current=(await send('get','/branches').expect(200)).body.branches.find((x:any)=>x.id===newBranch);
 await send('patch','/branches/'+newBranch).send({name:current.name,code:current.code,is_active:false,expected_version:current.version}).expect(204);
 await send('post','/orders',newBranch).send(order()).expect(403);
});
test('PromptPay image URLs retain the branch without custom image headers and reject other staff',async()=>{
 const actor=(await fixture.db.query("SELECT id FROM users WHERE role='owner'")).rows[0]!.id;
 await fixture.db.query("INSERT INTO payment_qr(id,image,sha256,updated_by,branch_id) VALUES('promptpay',$1,$2,$3,$4)",[Buffer.from('branch-test-fixture'),'b'.repeat(64),actor,b]);
 expect((await send('get','/payment-qr',a).expect(200)).body.available).toBe(false);
 const qr=(await send('get','/payment-qr',b).expect(200)).body;
 expect(qr.image_url).toContain('branch_id='+b);
 await request(app).get(qr.image_url).set('Cookie',owner).expect(200);
 await request(app).get(qr.image_url).set('Cookie',staff).expect(403);
});
test('concurrent branch transactions keep both stock balances and scoped reads independent',async()=>{
 const beforeA=await stock(a),beforeB=await stock(b);
 await Promise.all([send('post','/orders',a,staff).send(order()).expect(201),send('post','/orders',b).send(order()).expect(201)]);
 expect(await stock(a)).toBe(beforeA-10);expect(await stock(b)).toBe(beforeB-10);
 await send('put','/recipes/'+product,a,manager).send({expected_version:1,ingredients:[],steps:[]}).expect(403);
});
test('forecast histories stay branch-local even when a privileged legacy caller omits a scope',async()=>{
 await send('post','/orders',b).send({...order(),items:[{product_id:product,qty:2}]}).expect(201);
 const yesterday=new Date(Date.parse(businessDate())-86400000).toISOString().slice(0,10);
 await fixture.db.query("UPDATE orders SET status='completed',completed_at=$1::date::timestamp AT TIME ZONE 'Asia/Bangkok' WHERE branch_id=ANY($2::uuid[])",[yesterday,[a,b]]);
 const actor=(await fixture.db.query("SELECT id FROM users WHERE role='owner'")).rows[0]!.id;
 for(const branch of [a,b])await fixture.db.query("INSERT INTO day_closings(branch_id,date,closed_by,summary) VALUES($1,$2,$3,'{}')",[branch,yesterday,actor]);
 const legacy=await history(fixture.db,'actual');expect(legacy).toHaveLength(1);expect(Number(legacy[0]!.qty)).toBe(2);
 const scoped=branchDatabase(fixture.db);
 await inBranch({ids:[b],write:false,master:false},async()=>{
  const other=await history(scoped,'actual');expect(other).toHaveLength(1);expect(Number(other[0]!.qty)).toBe(4);
  const training=await dataset(scoped,[product],'genuine');expect(training.rows).toHaveLength(1);expect(training.rows[0]!.qty).toBe(4);
 });
});
test('table QR capabilities resolve their own branch and price, regardless of forged branch headers',async()=>{
 await send('post','/tables',a).send({name:'1'}).expect(201);
 const table=(await send('post','/tables',b).send({name:'1'}).expect(201)).body.id;
 const listed=(await send('get','/tables',b).expect(200)).body.tables.find((t:any)=>t.id===table);
 const menu=(await request(app).get('/api/guest/tables/'+listed.qr_token).set('X-Branch-Id',a).expect(200)).body;
 expect(menu.products.find((p:any)=>p.id===product).price_satang).toBe(7000);
 const key=randomUUID(),tracking=newToken();
 await request(app).post('/api/guest/tables/'+listed.qr_token+'/orders').set('Origin',origin).set('X-Branch-Id',a)
  .send({request_key:key,tracking_token:tracking,expected_total_satang:7000,items:[{product_id:product,qty:1}]}).expect(201);
 expect((await fixture.db.query('SELECT branch_id FROM orders WHERE request_key=$1',[key])).rows[0]?.branch_id).toBe(b);
 const branch=(await send('get','/branches').expect(200)).body.branches.find((x:any)=>x.id===b);
 await send('patch','/branches/'+b).send({name:branch.name,code:branch.code,is_active:false,expected_version:branch.version}).expect(204);
 await request(app).get('/api/guest/tables/'+listed.qr_token).expect(404);
 await request(app).get('/api/guest/orders/'+tracking).expect(200);
});
