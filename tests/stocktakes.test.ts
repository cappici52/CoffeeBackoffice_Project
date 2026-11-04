import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { test, expect } from 'vitest';
import { testDatabase } from './database.js';
import { migrate } from '../src/migrate.js';
import { seedOwner } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

test('stocktake reconciles explicit counts, preserves signed ledger, rejects stale count and commits idempotently',async()=>{
 const f=await testDatabase();
 try{
  await migrate(f.db);await seedOwner(f.db,'count@example.com','Test-count-password-123');
  const app=createApp(f.db,readConfig({DATABASE_URL:'postgresql://test:test@localhost/test'}));
  const login=await request(app).post('/api/auth/login').set('Origin','http://localhost:3001').send({email:'count@example.com',password:'Test-count-password-123'}).expect(200);
  const cookie=login.headers['set-cookie']![0]!.split(';')[0]!;
  const id=randomUUID();await f.db.query("INSERT INTO ingredients(id,name,unit) VALUES($1,'Count fixture','g')",[id]);
  const create=async(qty:number,version:number)=>request(app).post('/api/stocktakes').set('Cookie',cookie).set('Origin','http://localhost:3001').send({note:'Fixture physical count',lines:[{ingredient_id:id,counted_qty:qty,expected_version:version}]});
  const first=await create(10,1);expect(first.status).toBe(201);
  const commit=()=>request(app).post(`/api/stocktakes/${first.body.id}/commit`).set('Cookie',cookie).set('Origin','http://localhost:3001').send({});
  await commit().expect(204);await commit().expect(204);
  await expect(f.db.query("UPDATE stocktakes SET note='rewrite' WHERE id=$1",[first.body.id])).rejects.toThrow();
  await expect(f.db.query('UPDATE stocktake_lines SET counted_qty=500 WHERE stocktake_id=$1',[first.body.id])).rejects.toThrow();
  const stock=(await f.db.query('SELECT * FROM branch_stock WHERE ingredient_id=$1 AND branch_id=coffee_current_branch()',[id])).rows[0]!;
  expect(Number(stock.current_stock)).toBe(10);expect(stock.counted_at).toBeTruthy();
  const movements=(await f.db.query('SELECT * FROM stock_movements WHERE ingredient_id=$1',[id])).rows;
  expect(movements).toHaveLength(1);expect(movements[0]!.type).toBe('adjustment');expect(Number(movements[0]!.qty)).toBe(10);
  const stale=await create(8,stock.version);expect(stale.status).toBe(201);
  await request(app).post('/api/stock-movements').set('Cookie',cookie).set('Origin','http://localhost:3001').send({ingredient_id:id,type:'receipt',qty:1,reason:'Fixture intervening receipt'}).expect(204);
  await request(app).post(`/api/stocktakes/${stale.body.id}/commit`).set('Cookie',cookie).set('Origin','http://localhost:3001').send({}).expect(409);
  expect(Number((await f.db.query('SELECT current_stock FROM branch_stock WHERE ingredient_id=$1 AND branch_id=coffee_current_branch()',[id])).rows[0]!.current_stock)).toBe(11);
 }finally{await f.close();}
},30000);
