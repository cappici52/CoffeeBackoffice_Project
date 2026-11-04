import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import { migrate } from '../src/migrate.js';
import { hashPassword, newToken, tokenHash, type Role } from '../src/security.js';
import { seedOwner } from '../src/seed.js';
import { testDatabase } from './database.js';

const origin = 'http://localhost:3001';
const password = 'Coffee-test-password1';
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let app: ReturnType<typeof createApp>;
const cookies = {} as Record<Role, string>;
const ids = {} as Record<Role, string>;
async function login(email: string, pass = password) {
  const response = await request(app).post('/api/auth/login').set('Origin', origin).send({ email, password: pass }).expect(200);
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('Expected a session cookie');
  return cookie.split(';')[0]!;
}
const post = (path: string, cookie = cookies.owner) => request(app).post(path).set('Origin', origin).set('Cookie', cookie);
beforeAll(async () => {
  fixture = await testDatabase();
  await migrate(fixture.db);
  await seedOwner(fixture.db, 'owner@example.com', password);
  const hash = await hashPassword(password);
  for (const role of ['manager', 'cashier', 'kitchen'] as const) {
    await fixture.db.query('INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), role, `${role}@example.com`, hash, role]);
  }
  await fixture.db.query("INSERT INTO user_branches(user_id,branch_id) SELECT id,'00000000-0000-4000-8000-000000000016' FROM users WHERE role<>'owner' ON CONFLICT DO NOTHING");
  app = createApp(fixture.db, readConfig({ DATABASE_URL: 'postgresql://test:test@localhost/test', APP_ORIGIN: origin }));
  for (const role of ['owner', 'manager', 'cashier', 'kitchen'] as const) {
    cookies[role] = await login(`${role}@example.com`);
    ids[role] = (await fixture.db.query('SELECT id FROM users WHERE role = $1', [role])).rows[0]!.id;
  }
}, 30_000);
afterAll(async () => fixture?.close());

test('login stores only the token hash and exposes secure cookie attributes', async () => {
  const response = await post('/api/auth/login').send({ email: 'OWNER@example.com', password }).expect(200);
  expect(response.body.user).not.toHaveProperty('password_hash');
  const cookie = response.headers['set-cookie']?.[0];
  if (!cookie) throw new Error('Expected a session cookie');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Strict');
  const raw = cookie.split(';')[0]!.split('=')[1]!;
  const stored = (await fixture.db.query('SELECT token_hash FROM sessions WHERE token_hash = $1', [tokenHash(raw)])).rows;
  expect(stored).toHaveLength(1);
  expect(stored[0]?.token_hash).not.toBe(raw);
});
test('rejects missing session, invalid credentials, malformed JSON and unknown fields', async () => {
  await request(app).get('/api/auth/me').expect(401);
  await post('/api/auth/login').send({ email: 'missing@example.com', password }).expect(401, { error: 'INVALID_CREDENTIALS' });
  await post('/api/auth/login').send({ email: 'owner@example.com', password: 'wrong' }).expect(401, { error: 'INVALID_CREDENTIALS' });
  await post('/api/auth/login').set('Content-Type', 'application/json').send('{').expect(400, { error: 'INVALID_JSON' });
  await post('/api/users').send({ name: 'A', email: 'test@example.com', password, role: 'cashier', admin: true }).expect(400);
});
test('rejects missing/foreign Origin on mutations, permits configured preflight', async () => {
  await request(app).post('/api/auth/login').send({ email: 'owner@example.com', password }).expect(403);
  await request(app).post('/api/auth/logout').set('Cookie', cookies.owner).set('Origin', 'https://evil.example').expect(403);
  const response = await request(app).options('/api/auth/login').set('Origin', origin).expect(204);
  expect(response.headers['access-control-allow-origin']).toBe(origin);
});
test('all roles can inspect their own account; cashier/kitchen cannot list users', async () => {
  for (const role of ['owner', 'manager', 'cashier', 'kitchen'] as const) {
    const me = await request(app).get('/api/auth/me').set('Cookie', cookies[role]).expect(200);
    expect(me.body.user.role).toBe(role);
    await request(app).get('/api/users').set('Cookie', cookies[role]).expect(['owner', 'manager'].includes(role) ? 200 : 403);
  }
});
test('user listing is paginated and managers see staff only', async () => {
  const response = await request(app).get('/api/users?page=1&page_size=1').set('Cookie', cookies.manager).expect(200);
  expect(response.body.users).toHaveLength(1);
  expect(response.body.total).toBe(2);
  expect(['cashier', 'kitchen']).toContain(response.body.users[0].role);
  expect(response.body.users[0]).not.toHaveProperty('password_hash');
  await request(app).get('/api/users?page_size=999').set('Cookie', cookies.owner).expect(400);
});
test('manager may create staff but cannot create or promote privileged roles', async () => {
  for (const role of ['owner', 'manager']) {
    await post('/api/users', cookies.manager).send({ name: 'Invalid', email: `${role}2@example.com`, password, role }).expect(403);
  }
  const response = await post('/api/users', cookies.manager).send({ name: 'New barista', email: 'barista@example.com', password, role: 'kitchen' }).expect(201);
  const id = response.body.user.id;
  await request(app).patch(`/api/users/${id}`).set('Origin', origin).set('Cookie', cookies.manager).send({ role: 'owner' }).expect(403);
  await request(app).patch(`/api/users/${ids.owner}`).set('Origin', origin).set('Cookie', cookies.manager).send({ name: 'Hacked' }).expect(403);
  await post('/api/users').send({ name: 'Duplicate', email: 'BARISTA@example.com', password, role: 'kitchen' }).expect(409);
});
test('owner cannot revoke their own access', async () => {
  for (const body of [{ is_active: false }, { role: 'cashier' }]) {
    await request(app).patch(`/api/users/${ids.owner}`).set('Origin', origin).set('Cookie', cookies.owner).send(body).expect(409);
  }
});
test('role changes and account deactivation invalidate existing sessions', async () => {
  const created = await post('/api/users').send({ name: 'Temporary', email: 'temp@example.com', password, role: 'cashier' }).expect(201);
  const id = created.body.user.id;
  const cookie = await login('temp@example.com');
  await request(app).patch(`/api/users/${id}`).set('Origin', origin).set('Cookie', cookies.owner).send({ role: 'kitchen' }).expect(200);
  await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  const second = await login('temp@example.com');
  await request(app).patch(`/api/users/${id}`).set('Origin', origin).set('Cookie', cookies.owner).send({ is_active: false }).expect(200);
  await request(app).get('/api/auth/me').set('Cookie', second).expect(401);
  await post('/api/auth/login').send({ email: 'temp@example.com', password }).expect(401);
});
test('password changes require the old password and revoke every session', async () => {
  const created = await post('/api/users').send({ name: 'Password user', email: 'pass@example.com', password, role: 'cashier' }).expect(201);
  const first = await login('pass@example.com');
  const second = await login('pass@example.com');
  await post('/api/auth/change-password', first).send({ current_password: 'wrong', new_password: 'New-long-password1' }).expect(401);
  await post('/api/auth/change-password', first).send({ current_password: password, new_password: 'New-long-password1' }).expect(204);
  await request(app).get('/api/auth/me').set('Cookie', first).expect(401);
  await request(app).get('/api/auth/me').set('Cookie', second).expect(401);
  const stored = (await fixture.db.query('SELECT password_hash FROM users WHERE id = $1', [created.body.user.id])).rows[0]?.password_hash;
  expect(stored).not.toBe('New-long-password1');
  await login('pass@example.com', 'New-long-password1');
});
test('logout revokes the current session', async () => {
  await post('/api/auth/logout', cookies.kitchen).expect(204);
  await request(app).get('/api/auth/me').set('Cookie', cookies.kitchen).expect(401);
});
test('expired sessions are rejected', async () => {
  const token = newToken();
  await fixture.db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() - interval '1 hour')", [tokenHash(token), ids.owner]);
  await request(app).get('/api/auth/me').set('Cookie', `coffee_session=${token}`).expect(401);
});
test('login rate limiting rejects repeated attempts', async () => {
  const limited = createApp(fixture.db, readConfig({ DATABASE_URL: 'postgresql://test:test@localhost/test' }));
  for (let i = 0; i < 15; i++) await request(limited).post('/api/auth/login').set('Origin', origin).send({}).expect(400);
  await request(limited).post('/api/auth/login').set('Origin', origin).send({}).expect(429, { error: 'TOO_MANY_ATTEMPTS' });
});
test('bootstrap never overwrites an existing owner; audits exclude credentials', async () => {
  expect(await seedOwner(fixture.db, 'owner@example.com', 'Different-password1')).toBe(false);
  const events = (await fixture.db.query('SELECT action, details FROM audit_logs')).rows;
  expect(events.some(e => e.action === 'user.password_changed')).toBe(true);
  expect(JSON.stringify(events)).not.toContain(password);
  expect(JSON.stringify(events)).not.toContain('password_hash');
});
describe('database invariants', () => {
  test('rolls back a failed transaction including its audit insert', async () => {
    const id = randomUUID();
    await expect(fixture.db.transaction(async sql => {
      await sql.query("INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, 'Rollback', 'rollback@example.com', 'hash', 'cashier')", [id]);
      await sql.query("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id) VALUES ($1, 'test', 'user', $1)", [id]);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect((await fixture.db.query('SELECT id FROM users WHERE id = $1', [id])).rows).toHaveLength(0);
    expect((await fixture.db.query('SELECT id FROM audit_logs WHERE entity_id = $1', [id])).rows).toHaveLength(0);
  });
});
