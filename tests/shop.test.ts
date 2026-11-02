import {afterAll,beforeAll,expect,test} from 'vitest';
import request from 'supertest';
import {createApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {migrate} from '../src/migrate.js';
import {seedOwner} from '../src/seed.js';
import {testDatabase} from './database.js';
const origin='http://localhost:3001';
let fixture:Awaited<ReturnType<typeof testDatabase>>;
let app:ReturnType<typeof createApp>;let cookie:string;let category:string;let product:string;let ingredient:string;
const write=(method:'post'|'patch'|'put'|'delete',url:string)=>request(app)[method](url).set('Origin',origin).set('Cookie',cookie);
beforeAll(async()=>{fixture=await testDatabase();await migrate(fixture.db);await seedOwner(fixture.db,'owner@example.com','Coffee-owner-password1');app=createApp(fixture.db,readConfig({DATABASE_URL:'postgresql://test:test@localhost/test'}));const login=await request(app).post('/api/auth/login').set('Origin',origin).send({email:'owner@example.com',password:'Coffee-owner-password1'}).expect(200);cookie=login.headers['set-cookie']![0]!.split(';')[0]!;},30000);
afterAll(async()=>fixture?.close());
test('create categories, ingredients and configurable products',async()=>{
 category=(await write('post','/api/categories').send({name:'กาแฟ'}).expect(201)).body.category.id;
 ingredient=(await write('post','/api/ingredients').send({name:'เมล็ดกาแฟ',unit:'g',reorder_point:100,cost_satang:1}).expect(201)).body.id;
 const p=await write('post','/api/products').send({name:'ลาเต้',category_id:category,price_satang:7500,option_groups:[{name:'หวาน',is_required:true,multi_select:false,options:[{name:'ไม่หวาน'},{name:'หวานปกติ',extra_price_satang:500}]}]}).expect(201);
 product=p.body.product.id;expect(p.body.product.option_groups[0].options).toHaveLength(2);
 await write('delete',`/api/categories/${category}`).expect(409);
});
test('recipes use optimistic versions and reject duplicate ingredients',async()=>{
 const recipe={expected_version:0,ingredients:[{ingredient_id:ingredient,qty:18}],steps:[{instruction:'บดกาแฟและสกัดช็อต',timer_seconds:30}]};
 await write('put',`/api/recipes/${product}`).send(recipe).expect(204);
 await write('put',`/api/recipes/${product}`).send(recipe).expect(409);
 const response=await request(app).get(`/api/recipes/${product}`).set('Cookie',cookie).expect(200);expect(Number(response.body.recipe.ingredients[0].qty)).toBe(18);
 await write('delete',`/api/ingredients/${ingredient}`).expect(409);
});
test('stock receipts and waste are atomic and never negative',async()=>{
 await write('post','/api/stock-movements').send({ingredient_id:ingredient,type:'receipt',qty:200,reason:'รับของ'}).expect(204);
 await write('post','/api/stock-movements').send({ingredient_id:ingredient,type:'waste',qty:250,reason:'เสียหาย'}).expect(409);
 expect(Number((await fixture.db.query('SELECT current_stock FROM ingredients WHERE id=$1',[ingredient])).rows[0]?.current_stock)).toBe(200);
 await write('post','/api/stock-movements').send({ingredient_id:ingredient,type:'waste',qty:10,reason:'เสียหาย'}).expect(204);
 const movements=await request(app).get('/api/stock-movements').set('Cookie',cookie).expect(200);expect(movements.body.total).toBe(2);
});
test('stale product edits are rejected and price updates are audited',async()=>{
 await write('patch',`/api/products/${product}`).send({price_satang:8000,expected_version:1}).expect(200);
 await write('patch',`/api/products/${product}`).send({price_satang:100,expected_version:1}).expect(409);
 expect((await fixture.db.query("SELECT id FROM audit_logs WHERE action='product.updated'")).rows).toHaveLength(1);
});
