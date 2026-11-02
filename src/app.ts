import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import type { Database } from './db.js';
import type { Config } from './config.js';
import { authentication } from './auth.js';
import { usersRouter } from './users.js';
import { ApiError } from './security.js';
import { catalogRouter } from './shop/catalog.js';
import { inventoryRouter } from './shop/inventory.js';
import { ordersRouter } from './shop/orders.js';
import {reportsRouter} from './shop/reports.js';
import {forecastsRouter} from './shop/forecasts.js';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';

export function createApp(db: Database, config: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({contentSecurityPolicy:{directives:{imgSrc:["'self'",'data:','https:']}}}));
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', async (_req, res) => {
    try { await db.query('SELECT 1'); res.json({ status: 'ok' }); }
    catch { res.status(503).json({ error: 'DATABASE_UNAVAILABLE' }); }
  });
  const auth = authentication(db, config);
  app.use('/api', auth.router);
  app.use('/api/users', usersRouter(db, auth.authenticate, auth.requireRoles('owner', 'manager')));
  app.use('/api', catalogRouter(db,auth.authenticate,auth.requireRoles('owner','manager'),auth.requireRoles('owner','manager','cashier')));
  app.use('/api', inventoryRouter(db,auth.authenticate,auth.requireRoles('owner','manager')));
  app.use('/api', ordersRouter(db,auth.authenticate,auth.requireRoles('owner','manager','cashier')));
  app.use('/api',reportsRouter(db,auth.authenticate,auth.requireRoles('owner','manager'),auth.requireRoles('owner')));
  app.use('/api',forecastsRouter(db,config,auth.authenticate,auth.requireRoles('owner','manager')));
  const frontend=resolve('dist/client');
  if(existsSync(frontend)){
    app.use(express.static(frontend));
    app.get('/{*path}',(req,res,next)=>{if(req.path.startsWith('/api/')){next();return;}res.set('Cache-Control','no-store').sendFile(resolve(frontend,'index.html'));});
  }
  app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof ApiError) { res.status(error.status).json({ error: error.code }); return; }
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'VALIDATION_ERROR', issues: error.issues.map(i => ({ path: i.path, message: i.message })) });
      return;
    }
    if (typeof error === 'object' && error !== null) {
      if ('code' in error && error.code === '23505') { res.status(409).json({ error: 'ALREADY_EXISTS' }); return; }
      if ('code' in error && error.code === '23503') { res.status(409).json({ error: 'REFERENCE_IN_USE_OR_MISSING' }); return; }
      if ('code' in error && error.code === '23514') { res.status(400).json({ error: 'INVALID_VALUE' }); return; }
      if ('type' in error && error.type === 'entity.too.large') { res.status(413).json({ error: 'BODY_TOO_LARGE' }); return; }
      if ('type' in error && error.type === 'entity.parse.failed') { res.status(400).json({ error: 'INVALID_JSON' }); return; }
    }
    // Do not log request bodies, cookies, SQL parameter values or password validation inputs.
    console.error('Unhandled API error', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: 'INTERNAL_ERROR' });
  };
  app.use(handleError);
  return app;
}
