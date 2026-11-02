import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { readConfig } from './config.js';
import { connectDatabase, type Database } from './db.js';
import { audit, emailSchema, hashPassword, passwordSchema } from './security.js';

export async function seedOwner(db: Database, email: string, password: string) {
  const input = z.object({ email: emailSchema, password: passwordSchema }).parse({ email, password });
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async sql => {
    await sql.query('SELECT pg_advisory_xact_lock(7301002)');
    const existing = await sql.query('SELECT id FROM users LIMIT 1');
    if (existing.rows.length) return false; // Bootstrap once; never reset existing credentials.
    const id = randomUUID();
    await sql.query("INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, 'เจ้าของร้าน', $2, $3, 'owner')", [id, input.email, passwordHash]);
    await audit(sql, id, 'user.bootstrapped', id, { role: 'owner' });
    return true;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = readConfig();
  const email = z.string().min(1).parse(process.env.SEED_OWNER_EMAIL);
  const password = passwordSchema.parse(process.env.SEED_OWNER_PASSWORD);
  const db = connectDatabase(config.DATABASE_URL);
  try { console.log(await seedOwner(db, email, password) ? 'Owner created' : 'Users already exist; seed skipped'); }
  finally { await db.close(); }
}
