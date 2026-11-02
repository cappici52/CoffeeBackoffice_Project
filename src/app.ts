import express from 'express';
import helmet from 'helmet';
import type { Database } from './db.js';
import type { Config } from './config.js';

export function createApp(db: Database, _config: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', async (_req, res) => {
    try { await db.query('SELECT 1'); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ error: 'DATABASE_UNAVAILABLE' }); }
  });
  return app;
}
