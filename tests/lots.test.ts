import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { test,expect } from 'vitest';
import { testDatabase } from './database.js';
import { migrate } from '../src/migrate.js';
import { seedOwner } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { moveStock } from '../src/shop/shared.js';

test('lot stock follows FEFO, rejects expired sales atomically, and supports explicit expired waste',async()=>{
 const f=await testDatabase();try{
  await migrate(f.db);await seedOwner(f.db,'lots@example.com','Test-lots-password-123');
  const actor=(await f.db.query('SELECT id FROM users')).rows[0]!.id;
  const app=createApp(f.db,readConfig({DATABASE_URL:'postgresql://test:test@localhost/test'}));
  const login=await request(app).post('/api/auth/login').set('Origin','http://localhost:3001').send({email:'lots@example.com',password:'Test-lots-password-123'}).expect(200);
  const cookie=login.headers['set-cookie']![0]!.split(';')[0]!,ingredient=randomUUID();
  await f.db.query("INSERT INTO ingredients(id,name,unit) VALUES($1,'Lot fixture','g')",[ingredient]);
  const receive=async(code:string,expiry:string,qty:number)=>{
   const r=await request(app).post('/api/inventory-lots/receive').set('Cookie',cookie).set('Origin','http://localhost:3001').send({ingredient_id:ingredient,qty,code,expires_on:expiry,unit_cost_satang:2,reason:'Lot fixture receipt'}).expect(201);return r.body.id;
  };
  const later=await receive('Later','2099-02-01',20),earlier=await receive('Earlier','2099-01-01',5);
  await f.db.transaction(sql=>moveStock(sql,actor,ingredient,'sale',-15,'Fixture FEFO sale'));
  expect(Number((await f.db.query('SELECT remaining_qty FROM inventory_lots WHERE id=$1',[earlier])).rows[0]!.remaining_qty)).toBe(0);
  expect(Number((await f.db.query('SELECT remaining_qty FROM inventory_lots WHERE id=$1',[later])).rows[0]!.remaining_qty)).toBe(10);
  const expired=await receive('Expired','2000-01-01',30);
  await expect(f.db.transaction(sql=>moveStock(sql,actor,ingredient,'sale',-11,'Fixture rejected expired sale'))).rejects.toThrow();
  expect(Number((await f.db.query('SELECT current_stock FROM branch_stock WHERE ingredient_id=$1 AND branch_id=coffee_current_branch()',[ingredient])).rows[0]!.current_stock)).toBe(40);
  await request(app).post(`/api/inventory-lots/${expired}/waste`).set('Cookie',cookie).set('Origin','http://localhost:3001').send({qty:30,reason:'Expired fixture disposal'}).expect(204);
  expect(Number((await f.db.query('SELECT remaining_qty FROM inventory_lots WHERE id=$1',[expired])).rows[0]!.remaining_qty)).toBe(0);
  const durable=await request(app).post('/api/inventory-lots/receive').set('Cookie',cookie).set('Origin','http://localhost:3001').send({ingredient_id:ingredient,qty:1,code:'Non-perishable fixture',expires_on:null,no_expiry:true,unit_cost_satang:null,reason:'Fixture explicit expiry status'}).expect(201);
  expect((await f.db.query('SELECT expiry_kind FROM inventory_lots WHERE id=$1',[durable.body.id])).rows[0]!.expiry_kind).toBe('none');
 }finally{await f.close();}
},30000);
