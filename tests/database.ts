import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { connectDatabase, type Database, type Sql } from '../src/db.js';

export async function testDatabase() {
  if (process.env.TEST_DATABASE_URL) {
    const root = connectDatabase(process.env.TEST_DATABASE_URL);
    // Generated identifier only, never a user-supplied SQL identifier.
    const schema = `test_${randomUUID().replaceAll('-', '')}`;
    await root.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-csearch_path=${schema}`);
    const db = connectDatabase(url.toString());
    return { db, async close() {
      try { await db.close(); await root.query(`DROP SCHEMA ${schema} CASCADE`); }
      finally { await root.close(); }
    } };
  }
  const pg = new PGlite();
  const sqlFor = (client: Pick<PGlite, 'query' | 'exec'>): Sql => ({
    async query<T>(text: string, values?: unknown[]) {
      // PGlite's query uses the extended protocol; migration files contain multiple statements.
      if (values === undefined && text.includes(';')) {
        await client.exec(text);
        return { rows: [] as T[] };
      }
      const result = await client.query<T>(text, values);
      return { rows: result.rows };
    },
  });
  const db: Database = {
    ...sqlFor(pg),
    transaction: work => pg.transaction(tx => work(sqlFor(tx))),
  };
  return { db, close: () => pg.close() };
}
