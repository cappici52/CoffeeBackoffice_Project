import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,test} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {migrate} from '../src/migrate.js';
import {seedOwner} from '../src/seed.js';
import {testDatabase} from './database.js';
const origin='http://localhost:3001';const password='Coffee-owner-password1';
let fixture:Awaited<ReturnType<typeof testDatabase>>;let app:ReturnType<typeof createApp>;let cookie:string;let kitchen:string;let cashier:string;
let product:string;let ingredient:string;let option:string;let mainOrder:any;let mainBody:any;
const write=(url:string,body:object,session=cookie)=>request(app).post(url).set('Origin',origin).set('Cookie',session).send(body);
const balance=async()=>Number((await fixture.db.query('SELECT current_stock FROM ingredients WHERE id=$1',[ingredient])).rows[0]?.current_stock);
const orderBody=()=>({request_key:randomUUID(),type:'takeaway',payment_method:'cash',items:[{product_id:product,qty:1,option_ids:[option]}]});
beforeAll(async()=>{
 fixture=await testDatabase();await migrate(fixture.db);await seedOwner(fixture.db,'owner@example.com',password);app=createApp(fixture.db,readConfig({DATABASE_URL:'postgresql://test:test@localhost/test'}));
 const hash=(await fixture.db.query('SELECT password_hash FROM users LIMIT 1')).rows[0]?.password_hash;
 for(const role of ['kitchen','cashier'])await fixture.db.query('INSERT INTO users (id,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$2)',[randomUUID(),role,`${role}@example.com`,hash]);
 async function login(email:string){const r=await request(app).post('/api/auth/login').set('Origin',origin).send({email,password}).expect(200);return r.headers['set-cookie']![0]!.split(';')[0]!;}
 cookie=await login('owner@example.com');kitchen=await login('kitchen@example.com');cashier=await login('cashier@example.com');
 const category=(await write('/api/categories',{name:'กาแฟ'}).expect(201)).body.category.id;
 ingredient=(await write('/api/ingredients',{name:'เมล็ด',unit:'g',reorder_point:100,cost_satang:2}).expect(201)).body.id;
 await write('/api/stock-movements',{ingredient_id:ingredient,type:'receipt',qty:1000,reason:'เปิดร้าน'}).expect(204);
 const p=(await write('/api/products',{name:'ลาเต้',category_id:category,price_satang:7500,option_groups:[{name:'ขนาด',is_required:true,multi_select:false,options:[{name:'ใหญ่',extra_price_satang:500},{name:'ปกติ'}]}]}).expect(201)).body.product;
 product=p.id;option=p.option_groups[0].options[0].id;
 await request(app).put(`/api/recipes/${product}`).set('Origin',origin).set('Cookie',cookie).send({expected_version:0,ingredients:[{ingredient_id:ingredient,qty:18}],steps:[{instruction:'สกัดช็อต'}]}).expect(204);
},30000);
afterAll(async()=>fixture?.close());
test('calculates price on server and deducts stock exactly once',async()=>{
 const before=await balance();mainBody={...orderBody(),items:[{product_id:product,qty:2,option_ids:[option]}]};mainOrder=(await write('/api/orders',mainBody,cashier).expect(201)).body.order;
 expect(mainOrder.total_satang).toBe(16000);expect(await balance()).toBe(before-36);
 const retry=(await write('/api/orders',mainBody,cashier).expect(201)).body.order;expect(retry.id).toBe(mainOrder.id);expect(await balance()).toBe(before-36);
 await write('/api/orders',{...mainBody,note:'changed'},cashier).expect(409);
 await write(`/api/orders/${mainOrder.id}/pay`,{method:'cash'},cashier).expect(200);expect(await balance()).toBe(before-36);
});
test('invalid options and insufficient stock roll back the whole order',async()=>{
 const count=(await fixture.db.query('SELECT count(*)::int AS count FROM orders')).rows[0]?.count;
 await write('/api/orders',{...orderBody(),items:[{product_id:product,qty:1,option_ids:[]}]}).expect(400);
 await write('/api/orders',{...orderBody(),items:[{product_id:product,qty:99,option_ids:[option]}]}).expect(409);
 expect((await fixture.db.query('SELECT count(*)::int AS count FROM orders')).rows[0]?.count).toBe(count);
});
test('simultaneous retries produce one order and one deduction',async()=>{
 const before=await balance();const body=orderBody();const [a,b]=await Promise.all([write('/api/orders',body),write('/api/orders',body)]);expect(a.status).toBe(201);expect(b.status).toBe(201);expect(a.body.order.id).toBe(b.body.order.id);expect(await balance()).toBe(before-18);
});
test('kitchen has KDS-only domain access and receives no financial fields',async()=>{
 for(const url of ['/api/orders','/api/catalog','/api/ingredients'])await request(app).get(url).set('Cookie',kitchen).expect(403);
 const kds=await request(app).get('/api/kds').set('Cookie',kitchen).expect(200);expect(kds.body.orders.length).toBeGreaterThan(0);
 expect(JSON.stringify(kds.body)).not.toMatch(/price_satang|cost_satang|total_satang|payment/);
});
test('KDS validates transitions and records per-item preparation times',async()=>{
 const item=mainOrder.items[0].id;
 await write(`/api/kds/items/${item}/status`,{status:'ready'},kitchen).expect(409);
 await write(`/api/kds/items/${item}/status`,{status:'preparing'},kitchen).expect(204);
 await write(`/api/orders/${mainOrder.id}/status`,{status:'completed'}).expect(409);
 await write(`/api/kds/items/${item}/status`,{status:'ready'},kitchen).expect(204);
 await write(`/api/orders/${mainOrder.id}/status`,{status:'completed'},cashier).expect(200);
 const detail=(await request(app).get(`/api/orders/${mainOrder.id}`).set('Cookie',cookie)).body.order;
 expect(detail.status).toBe('completed');expect(detail.items[0].started_at).toBeTruthy();expect(detail.items[0].completed_at).toBeTruthy();
 await write(`/api/kds/items/${item}/status`,{status:'preparing'},kitchen).expect(409);
});
test('refund requires manager confirmation; unstarted ingredients are returned once',async()=>{
 const before=await balance();const o=(await write('/api/orders',orderBody()).expect(201)).body.order;
 await write(`/api/orders/${o.id}/status`,{status:'cancelled',reason:'ลูกค้ายกเลิก',confirm_refund:true},cashier).expect(403);
 await write(`/api/orders/${o.id}/status`,{status:'cancelled',reason:'ลูกค้ายกเลิก'}).expect(400);
 await write(`/api/orders/${o.id}/status`,{status:'cancelled',reason:'ลูกค้ายกเลิก',confirm_refund:true}).expect(200);
 expect(await balance()).toBe(before);await write(`/api/orders/${o.id}/status`,{status:'cancelled',reason:'ซ้ำ',confirm_refund:true}).expect(200);expect(await balance()).toBe(before);
});
test('cancelled prepared orders do not return consumed ingredients',async()=>{
 const before=await balance();const o=(await write('/api/orders',orderBody()).expect(201)).body.order;
 await write(`/api/kds/items/${o.items[0].id}/status`,{status:'preparing'},kitchen).expect(204);
 await write(`/api/orders/${o.id}/status`,{status:'cancelled',reason:'ทำผิด',confirm_refund:true}).expect(200);expect(await balance()).toBe(before-18);
});
test('ingredient substitution changes recipe snapshot and actual stock deduction',async()=>{
 const oat=(await write('/api/ingredients',{name:'โอ๊ต',unit:'g',reorder_point:0,cost_satang:3}).expect(201)).body.id;
 await write('/api/stock-movements',{ingredient_id:oat,type:'receipt',qty:100,reason:'รับเข้า'}).expect(204);
 const update=(await request(app).patch(`/api/products/${product}`).set('Origin',origin).set('Cookie',cookie).send({expected_version:1,option_groups:[{name:'วัตถุดิบ',is_required:true,multi_select:false,options:[{name:'โอ๊ต',ingredient_id:oat,ingredient_qty:20,replaces_ingredient_id:ingredient}]}]}).expect(200)).body.product;
 const before=await balance();const body={...orderBody(),items:[{product_id:product,qty:1,option_ids:[update.option_groups[0].options[0].id]}]};
 const o=(await write('/api/orders',body).expect(201)).body.order;expect(o.items[0].ingredients[0].name).toBe('โอ๊ต');expect(await balance()).toBe(before);
 expect(Number((await fixture.db.query('SELECT current_stock FROM ingredients WHERE id=$1',[oat])).rows[0]?.current_stock)).toBe(80);
});
