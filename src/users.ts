import { randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Database, Sql } from './db.js';
import { ApiError, audit, canManage, emailSchema, hashPassword, passwordSchema, roles, userColumns, type User } from './security.js';
import { LEGACY_BRANCH } from './branch-context.js';

export function usersRouter(db: Database, authenticate: RequestHandler, authorize: RequestHandler) {
  const router = Router();
  router.use(authenticate, authorize);
  const fields = z.object({ name: z.string().trim().min(1).max(100), role: z.enum(roles), is_active: z.boolean() });
  // Serialize administrative writes and re-check the actor's current authority inside the transaction.
  async function actorInTransaction(sql: Sql, id: string) {
    await sql.query('SELECT pg_advisory_xact_lock(7301002)');
    const result = await sql.query<User>(`SELECT ${userColumns} FROM users WHERE id = $1 AND is_active = true`, [id]);
    const actor = result.rows[0];
    if (!actor || !['owner', 'manager'].includes(actor.role)) throw new ApiError(403, 'FORBIDDEN');
    if (actor.role !== 'owner' && !(await sql.query('SELECT 1 FROM user_branches WHERE user_id=$1 AND branch_id=$2', [id, LEGACY_BRANCH])).rows.length) {
      throw new ApiError(403, 'BRANCH_FORBIDDEN');
    }
    return actor;
  }
  router.get('/', async (req, res) => {
    const { page, page_size } = z.object({ page: z.coerce.number().int().min(1).max(1_000_000).default(1), page_size: z.coerce.number().int().min(1).max(100).default(25) }).strict().parse(req.query);
    const actor = res.locals.user as User;
    const filter = `($1='owner' OR (role IN ('cashier','kitchen')
      AND EXISTS(SELECT 1 FROM user_branches t WHERE t.user_id=users.id AND t.branch_id=$2)
      AND EXISTS(SELECT 1 FROM user_branches a WHERE a.user_id=$3 AND a.branch_id=$2)))`;
    const scope = [actor.role, LEGACY_BRANCH, actor.id];
    const result = await db.query<User>(`SELECT ${userColumns} FROM users WHERE ${filter} ORDER BY created_at, id LIMIT $4 OFFSET $5`, [...scope, page_size, (page - 1) * page_size]);
    const count = await db.query(`SELECT count(*)::int AS total FROM users WHERE ${filter}`, scope);
    res.json({ users: result.rows, page, page_size, total: count.rows[0]?.total });
  });
  router.post('/', async (req, res) => {
    const input = fields.omit({ is_active: true }).extend({ email: emailSchema, password: passwordSchema }).strict().parse(req.body);
    const passwordHash = await hashPassword(input.password);
    const user = await db.transaction(async sql => {
      const actor = await actorInTransaction(sql, (res.locals.user as User).id);
      if (!canManage(actor.role, input.role)) throw new ApiError(403, 'FORBIDDEN');
      const result = await sql.query<User>(`INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING ${userColumns}`,
        [randomUUID(), input.name, input.email, passwordHash, input.role]);
      const created = result.rows[0]!;
      if(created.role!=='owner'){
        await sql.query('INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2)',[created.id,LEGACY_BRANCH]);
      }
      await audit(sql, actor.id, 'user.created', created.id, { role: created.role });
      return created;
    });
    res.status(201).json({ user });
  });
  router.patch('/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = fields.partial().strict().refine(v => Object.keys(v).length > 0, 'Provide at least one field').parse(req.body);
    const user = await db.transaction(async sql => {
      const actor = await actorInTransaction(sql, (res.locals.user as User).id);
      const result = await sql.query<User>(`SELECT ${userColumns} FROM users WHERE id = $1 FOR UPDATE`, [id]);
      const target = result.rows[0];
      if (!target) throw new ApiError(404, 'USER_NOT_FOUND');
      if(actor.role!=='owner'){
        const access = await sql.query('SELECT 1 FROM user_branches WHERE user_id=$1 AND branch_id=$2', [id, LEGACY_BRANCH]);
        if (!access.rows.length) throw new ApiError(403, 'BRANCH_FORBIDDEN');
      }
      if (!canManage(actor.role, target.role) || !canManage(actor.role, input.role ?? target.role)) throw new ApiError(403, 'FORBIDDEN');
      if (actor.id === id && (input.is_active === false || (input.role !== undefined && input.role !== actor.role))) throw new ApiError(409, 'CANNOT_REMOVE_OWN_ACCESS');
      if (target.role === 'owner' && target.is_active && (input.role && input.role !== 'owner' || input.is_active === false)) {
        const owners = await sql.query("SELECT count(*)::int AS count FROM users WHERE role = 'owner' AND is_active = true");
        if (owners.rows[0]?.count <= 1) throw new ApiError(409, 'LAST_OWNER_REQUIRED');
      }
      const changed = await sql.query<User>(`UPDATE users SET name = $1, role = $2, is_active = $3 WHERE id = $4 RETURNING ${userColumns}`,
        [input.name ?? target.name, input.role ?? target.role, input.is_active ?? target.is_active, id]);
      if (target.role === 'owner' && input.role && input.role !== 'owner') {
        await sql.query('INSERT INTO user_branches(user_id,branch_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [id, LEGACY_BRANCH]);
      }
      if (input.role !== undefined || input.is_active === false) await sql.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      await audit(sql, actor.id, 'user.updated', id, input);
      return changed.rows[0];
    });
    res.json({ user });
  });
  return router;
}
