import { PGlite } from '@electric-sql/pglite';
import type { Database, Sql } from '../src/db.js';

export async function testDatabase() {
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
