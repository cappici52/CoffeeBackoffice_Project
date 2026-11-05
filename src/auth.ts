import { Router, type RequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { Database } from './db.js';
import type { Config } from './config.js';
import { ApiError, audit, emailSchema, hashPassword, newToken, passwordSchema, tokenHash, userColumns, verifyPassword, type User, type Role } from './security.js';

export function authentication(db: Database, config: Config) {
  const cookieName = config.NODE_ENV === 'production' ? '__Host-coffee_session' : 'coffee_session';
  const cookieOptions = { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/' };
  // Match the configured bcrypt cost for unknown emails to avoid a fast account-existence signal.
  const dummyHash = hashPassword(newToken());
  const authenticate: RequestHandler = async (req, res, next) => {
    const token = req.cookies?.[cookieName];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, 'UNAUTHENTICATED');
    const result = await db.query<User>(`SELECT u.${userColumns.split(', ').join(', u.')} FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active = true`, [tokenHash(token)]);
    if (!result.rows[0]) throw new ApiError(401, 'UNAUTHENTICATED');
    res.locals.user = result.rows[0];
    res.locals.sessionHash = tokenHash(token);
    next();
  };
  const requireRoles = (...allowed: Role[]): RequestHandler => (_req, res, next) => {
    if (!allowed.includes((res.locals.user as User).role)) throw new ApiError(403, 'FORBIDDEN');
    next();
  };
  const router = Router();
  router.use(cookieParser());
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use((req, res, next) => {
    const origin = req.get('Origin');
    if (origin === config.APP_ORIGIN) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Credentials', 'true');
      res.vary('Origin');
    }
    if (req.method === 'OPTIONS') {
      if (origin !== config.APP_ORIGIN) throw new ApiError(403, 'ORIGIN_FORBIDDEN');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      res.sendStatus(204);
      return;
    }
    // Required even for login: reject cross-origin and missing-Origin mutations.
    if (!['GET', 'HEAD'].includes(req.method) && origin !== config.APP_ORIGIN) throw new ApiError(403, 'ORIGIN_FORBIDDEN');
    next();
  });
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'TOO_MANY_ATTEMPTS' } });
  router.post('/auth/login', loginLimiter, async (req, res) => {
    const input = z.object({ email: emailSchema, password: z.string().min(1).refine(v => Buffer.byteLength(v) <= 72) }).strict().parse(req.body);
    const token = newToken();
    const user = await db.transaction(async sql => {
      const result = await sql.query<User & { password_hash: string }>(`SELECT ${userColumns}, password_hash FROM users WHERE email = $1 FOR UPDATE`, [input.email]);
      const candidate = result.rows[0];
      const valid = await verifyPassword(input.password, candidate?.password_hash ?? await dummyHash);
      if (!candidate?.is_active || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS');
      await sql.query('DELETE FROM sessions WHERE expires_at <= now()');
      await sql.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + $3 * interval '1 hour')", [tokenHash(token), candidate.id, config.SESSION_HOURS]);
      await audit(sql, candidate.id, 'user.login', candidate.id);
      const { password_hash: _, ...safeUser } = candidate;
      return safeUser;
    });
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: config.SESSION_HOURS * 3_600_000 }).json({ user });
  });
  router.post('/auth/logout', authenticate, async (_req, res) => {
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [res.locals.sessionHash]);
    res.clearCookie(cookieName, cookieOptions).sendStatus(204);
  });
  router.get('/auth/me', authenticate, (_req, res) => res.json({ user: res.locals.user }));
  router.post('/auth/change-password', authenticate, loginLimiter, async (req, res) => {
    const input = z.object({ current_password: z.string().min(1).refine(v => Buffer.byteLength(v) <= 72), new_password: passwordSchema }).strict().parse(req.body);
    const user = res.locals.user as User;
    await db.transaction(async sql => {
      const result = await sql.query('SELECT password_hash FROM users WHERE id = $1 AND is_active = true FOR UPDATE', [user.id]);
      if (!result.rows[0] || !await verifyPassword(input.current_password, result.rows[0].password_hash)) throw new ApiError(401, 'INVALID_CREDENTIALS');
      await sql.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(input.new_password), user.id]);
      await sql.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      await audit(sql, user.id, 'user.password_changed', user.id);
    });
    res.clearCookie(cookieName, cookieOptions).sendStatus(204);
  });
  return { router, authenticate, requireRoles };
}
