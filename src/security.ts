import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Sql } from './db.js';

export const roles = ['owner', 'manager', 'cashier', 'kitchen'] as const;
export type Role = typeof roles[number];
export interface User { id: string; name: string; email: string; role: Role; is_active: boolean }
export const userColumns = 'id, name, email, role, is_active';
export const passwordSchema = z.string().min(12).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 UTF-8 bytes');
export const emailSchema = z.email().max(254).transform(value => value.toLowerCase());
export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('hex');
export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export function canManage(actor: Role, target: Role) {
  return actor === 'owner' || (actor === 'manager' && (target === 'cashier' || target === 'kitchen'));
}
export async function audit(sql: Sql, actorId: string, action: string, entityId: string, details: object = {}) {
  await sql.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [actorId, action, 'user', entityId, JSON.stringify(details)]);
}
