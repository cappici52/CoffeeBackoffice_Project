import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { readConfig } from '../src/config.js';
import { seedOwner } from '../src/seed.js';
import { LEGACY_BRANCH } from '../src/branch-context.js';
import { newToken } from '../src/security.js';
import { testDatabase } from './database.js';

const origin = 'http://localhost:3001';
const password = 'Shop-test-password1';
const archived = '00000000-0000-4000-8000-000000000017';
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof createApp>;
let owner: string;
let manager: string;
let managerId: string;

const get = (path: string, cookie = owner) => request(app).get('/api' + path).set('Cookie', cookie);
const post = (path: string, cookie = owner) => request(app).post('/api' + path).set('Cookie', cookie).set('Origin', origin);

beforeAll(async () => {
  fixture = await testDatabase();
  await migrate(fixture.db);
  await seedOwner(fixture.db, 'owner@example.com', password);
  app = createApp(fixture.db, readConfig({ DATABASE_URL: 'postgresql://test:test@localhost/test' }));
  const login = async (email: string) => (await request(app).post('/api/auth/login').set('Origin', origin)
    .send({ email, password }).expect(200)).headers['set-cookie']![0]!.split(';')[0]!;
  owner = await login('owner@example.com');
  managerId = (await post('/users').send({ name: 'Manager', email: 'manager@example.com', password, role: 'manager' }).expect(201)).body.user.id;
  manager = await login('manager@example.com');
}, 30000);
afterAll(async () => fixture?.close());

test('one active shop, retired routes and no alternate staff scope', async () => {
  expect((await fixture.db.query('SELECT id FROM branches WHERE is_active')).rows).toEqual([{ id: LEGACY_BRANCH }]);
  await expect(fixture.db.query('UPDATE branches SET is_active=true WHERE id=$1', [archived])).rejects.toThrow();
  await get('/orders').expect(200);
  await get('/orders').set('X-Branch-Id', LEGACY_BRANCH).expect(200);
  await get('/orders?branch_id=' + LEGACY_BRANCH).expect(200);
  await get('/orders?branch_id=' + archived).set('X-Branch-Id', LEGACY_BRANCH).expect(403);
  await get('/orders?branch_id=all&branch_id=' + LEGACY_BRANCH).expect(403);
  await get('/orders').set('X-Branch-Id', 'all').expect(403);
  await post('/orders').set('X-Branch-Id', archived).send({}).expect(403);
  for (const path of ['/branches', '/branch-products', '/stock-transfers']) await get(path).expect(404);
  await post('/branches').send({}).expect(404);
  await post('/stock-transfers').send({}).expect(404);
});

test('archived table tokens do not reopen for customers', async () => {
  const activeToken = newToken(), archivedToken = newToken();
  await fixture.db.query(
    "INSERT INTO dining_tables(id,name,qr_token,branch_id) VALUES($1,'Active table',$2,$3),($4,'Archived table',$5,$6)",
    [randomUUID(), activeToken, LEGACY_BRANCH, randomUUID(), archivedToken, archived],
  );
  await get('/guest/tables/' + activeToken).set('X-Branch-Id', archived).expect(200);
  await get('/guest/tables/' + archivedToken).expect(404);
  await post('/guest/tables/' + archivedToken + '/orders').send({}).expect(404);
});

test('a manager assigned only to an archived branch cannot operate or add staff', async () => {
  await get('/ingredients', manager).expect(200);
  await fixture.db.query('UPDATE user_branches SET branch_id=$1 WHERE user_id=$2 AND branch_id=$3',
    [archived, managerId, LEGACY_BRANCH]);
  await get('/ingredients', manager).expect(403);
  await post('/users', manager).send({ name: 'Cashier', email: 'blocked@example.com', password, role: 'cashier' }).expect(403);
});
