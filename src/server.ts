import { createApp } from './app.js';
import { readConfig } from './config.js';
import { connectDatabase } from './db.js';

const config = readConfig();
const db = connectDatabase(config.DATABASE_URL);
const server = createApp(db, config).listen(config.PORT, () => console.log(`API listening on port ${config.PORT}`));
function shutdown() {
  const timeout = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => { void db.close().then(() => { clearTimeout(timeout); process.exit(0); }); });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
