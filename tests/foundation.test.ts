import { afterAll, beforeAll, expect, test } from 'vitest';
import request from 'supertest';
import { testDatabase } from './database.js';
import { migrate } from '../src/migrate.js';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';

let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { fixture = await testDatabase(); await migrate(fixture.db); }, 30_000);
afterAll(async () => fixture?.close());
test('migrations are repeatable and health checks the database', async () => {
  await migrate(fixture.db);
  expect((await fixture.db.query('SELECT name FROM schema_migrations')).rows.length).toBeGreaterThanOrEqual(2);
  const app = createApp(fixture.db, readConfig({ DATABASE_URL: 'postgresql://test:test@localhost/test' }));
  await request(app).get('/api/health').expect(200, { status: 'ok' });
});
test('production requires a secure origin', () => {
  expect(() => readConfig({ DATABASE_URL: 'postgresql://test:test@localhost/test', NODE_ENV: 'production' })).toThrow('HTTPS');
});
