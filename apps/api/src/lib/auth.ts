import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../env.js';
import { newId, randomToken, sha256Hex } from './crypto.js';
import { first, run } from './db.js';
import { ApiError } from './http.js';

/** Sessions don't expire: a child's phone stays logged in until a new code replaces it. */
const TOUCH_EVERY_MS = 10 * 60_000;

export async function createSession(db: D1Database, memberId: string, now = Date.now()): Promise<{ token: string; sessionId: string }> {
  const token = randomToken();
  const sessionId = await sha256Hex(token);
  await run(
    db,
    'INSERT INTO session (id, member_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)',
    sessionId,
    memberId,
    now,
    now,
  );
  return { token, sessionId };
}

/**
 * Logs out every phone of a member (new phone, password reset, removal).
 * `keepSessionId` spares the phone making the request (own password change).
 */
export async function revokeMemberSessions(
  db: D1Database,
  memberId: string,
  now = Date.now(),
  keepSessionId: string | null = null,
): Promise<void> {
  const keep = keepSessionId ?? '';
  await db.batch([
    db.prepare('UPDATE session SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL AND id != ?').bind(now, memberId, keep),
    db
      .prepare('DELETE FROM device WHERE member_id = ? AND (session_id IS NULL OR session_id != ?)')
      .bind(memberId, keep),
  ]);
}

export const requireAuth: MiddlewareHandler<AppBindings> = async (c, next) => {
  const header = c.req.header('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new ApiError(401, 'unauthorized');
  const sessionId = await sha256Hex(token);
  const row = await first<{ member_id: string; family_id: string; role: 'parent' | 'child'; last_seen_at: number }>(
    c.env.DB,
    `SELECT s.member_id, m.family_id, m.role, s.last_seen_at
       FROM session s JOIN member m ON m.id = s.member_id
      WHERE s.id = ? AND s.revoked_at IS NULL AND m.removed_at IS NULL`,
    sessionId,
  );
  if (!row) throw new ApiError(401, 'unauthorized');
  const now = Date.now();
  if (now - row.last_seen_at > TOUCH_EVERY_MS) {
    await run(c.env.DB, 'UPDATE session SET last_seen_at = ? WHERE id = ?', now, sessionId);
  }
  c.set('auth', { memberId: row.member_id, familyId: row.family_id, role: row.role, sessionId });
  await next();
};

export const requireParent: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.get('auth').role !== 'parent') throw new ApiError(403, 'parent_only');
  await next();
};

/** Whether the member is the family's administrator (the adult who registered it). */
export async function isFamilyAdmin(db: D1Database, auth: { familyId: string; memberId: string }): Promise<boolean> {
  const f = await first<{ admin_member_id: string | null }>(db, 'SELECT admin_member_id FROM family WHERE id = ?', auth.familyId);
  return !!f && f.admin_member_id === auth.memberId;
}

export async function assertFamilyAdmin(db: D1Database, auth: { familyId: string; memberId: string }): Promise<void> {
  if (!(await isFamilyAdmin(db, auth))) throw new ApiError(403, 'admin_only');
}

/** Family settings, adults and removals are for the administrator only. */
export const requireAdmin: MiddlewareHandler<AppBindings> = async (c, next) => {
  await assertFamilyAdmin(c.env.DB, c.get('auth'));
  await next();
};

export const requireChild: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (c.get('auth').role !== 'child') throw new ApiError(403, 'child_only');
  await next();
};

export function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? 'local';
}

export { newId };
