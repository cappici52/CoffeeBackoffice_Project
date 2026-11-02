import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { connectDatabase, type Database } from './db.js';
import { readConfig } from './config.js';

export async function migrate(db: Database) {
  await db.transaction(async (sql) => {
    await sql.query('SELECT pg_advisory_xact_lock(7301001)');
    await sql.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const files = (await readdir(resolve('migrations'))).filter(f => f.endsWith('.sql')).sort();
    for (const name of files) {
      const source = await readFile(resolve('migrations', name), 'utf8');
      const checksum = createHash('sha256').update(source).digest('hex');
      const previous = await sql.query('SELECT checksum FROM schema_migrations WHERE name = $1', [name]);
      if (previous.rows.length) {
        if (previous.rows[0]?.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      await sql.query(source);
      await sql.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const db = connectDatabase(readConfig().DATABASE_URL);
  try { await migrate(db); console.log('Migrations applied'); }
  finally { await db.close(); }
}
