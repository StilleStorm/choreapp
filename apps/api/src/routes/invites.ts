/**
 * Invitations. A parent shows a QR code (long token) with a 6-digit code next
 * to it; the other phone scans or types it. One-time use, valid 15 minutes.
 *
 *  role child,  no member  -> a child joins: name (+ avatar later)
 *  role child,  member     -> a child's new phone: same profile, old phone logged out
 *  role parent, no member  -> another parent joins: name, e-mail, password
 *  role parent, member     -> password reset for that parent
 */
import {
  NEUTRAL_THEME,
  createInviteBody,
  inviteRef,
  redeemInviteBody,
  type InviteDto,
  type InviteInfoDto,
  type InviteStatusDto,
  type InviteSummaryDto,
} from '@choreapp/shared';
import { Hono } from 'hono';
import type { AppBindings, Env } from '../env.js';
import { assertFamilyAdmin, clientIp, isFamilyAdmin, createSession, requireParent, revokeMemberSessions } from '../lib/auth.js';
import { hashPassword, newId, randomToken, sha256Hex, sixDigitCode } from '../lib/crypto.js';
import { all, first, hit, isLimited, isUniqueViolation, run } from '../lib/db.js';
import { ApiError, badRequest, body, conflict, forbidden, notFound } from '../lib/http.js';
import { sessionResponse } from './account.js';

export const INVITE_TTL_MS = 15 * 60_000;
const FAIL_WINDOW = 15 * 60_000;
/** Wrong codes or links from one IP per window. */
const FAIL_LIMIT = 10;
/**
 * A 6-digit code can't tell which invite a wrong guess was aimed at, so every
 * wrong code counts against every live invite: after this many the code stops
 * working (the QR link, 256 random bits, still does). Holds even against
 * guesses spread over many IPs.
 */
export const CODE_MISS_LIMIT = 20;
/** Wrong codes from all IPs together per window; above it code entry pauses (QR links still work). */
export const GLOBAL_CODE_FAIL_LIMIT = 50;
const GLOBAL_CODE_FAIL_KEY = 'invite-code-fail:all';

interface InviteRow {
  id: string;
  family_id: string;
  role: 'parent' | 'child';
  member_id: string | null;
  expires_at: number;
  used_at: number | null;
  family_name: string;
  member_name: string | null;
}

async function findInvite(env: Env, ip: string, ref: { token?: string; code?: string }): Promise<InviteRow> {
  const failKey = `invite-fail:${ip}`;
  const byCode = !ref.token;
  if (await isLimited(env.DB, failKey, FAIL_LIMIT, FAIL_WINDOW)) throw new ApiError(429, 'too_many_attempts');
  if (byCode && (await isLimited(env.DB, GLOBAL_CODE_FAIL_KEY, GLOBAL_CODE_FAIL_LIMIT, FAIL_WINDOW))) {
    throw new ApiError(429, 'too_many_attempts');
  }
  const now = Date.now();
  const hash = await sha256Hex(ref.token ?? ref.code!);
  const row = await first<InviteRow>(
    env.DB,
    `SELECT i.*, f.name AS family_name, m.name AS member_name
       FROM invite i JOIN family f ON f.id = i.family_id LEFT JOIN member m ON m.id = i.member_id
      WHERE i.${byCode ? 'code_hash' : 'token_hash'} = ? AND i.used_at IS NULL AND i.expires_at > ?
        ${byCode ? `AND i.code_misses < ${CODE_MISS_LIMIT}` : ''}`,
    hash,
    now,
  );
  if (!row) {
    await hit(env.DB, failKey, 1_000_000, FAIL_WINDOW);
    if (byCode) {
      await hit(env.DB, GLOBAL_CODE_FAIL_KEY, 1_000_000, FAIL_WINDOW);
      await run(env.DB, 'UPDATE invite SET code_misses = code_misses + 1 WHERE used_at IS NULL AND expires_at > ?', now);
    }
    throw new ApiError(404, 'invite_invalid');
  }
  return row;
}

function kindOf(i: Pick<InviteRow, 'role' | 'member_id'>): InviteInfoDto['kind'] {
  if (!i.member_id) return 'join';
  return i.role === 'child' ? 'reconnect' : 'reset';
}

export const publicInvites = new Hono<AppBindings>()
  /** What the code is for, so the phone can show the right form. Does not use it up. */
  .post('/invites/inspect', async (c) => {
    const ref = await body(c, inviteRef);
    const i = await findInvite(c.env, clientIp(c.req.raw), ref);
    const dto: InviteInfoDto = { kind: kindOf(i), role: i.role, familyName: i.family_name, memberName: i.member_name };
    return c.json(dto);
  })

  .post('/invites/redeem', async (c) => {
    const b = await body(c, redeemInviteBody);
    if (!!b.token === !!b.code) throw badRequest('token_or_code');
    const i = await findInvite(c.env, clientIp(c.req.raw), b);
    const kind = kindOf(i);
    const now = Date.now();

    // Validate the form before using up the invite.
    if (kind === 'join' && !b.name) throw badRequest('name_required');
    if (kind === 'join' && i.role === 'parent' && (!b.email || !b.password)) throw badRequest('email_password_required');
    if (kind === 'reset' && !b.password) throw badRequest('password_required');
    if (kind !== 'join') {
      const m = await first(c.env.DB, 'SELECT 1 FROM member WHERE id = ? AND removed_at IS NULL', i.member_id);
      if (!m) throw new ApiError(404, 'invite_invalid');
    }
    if (kind === 'join' && i.role === 'parent') {
      const taken = await first(c.env.DB, 'SELECT 1 FROM parent_login WHERE email = ?', b.email!);
      if (taken) throw conflict('email_taken');
    }

    // Single use, even under concurrent redemption.
    const claimed = await run(c.env.DB, 'UPDATE invite SET used_at = ? WHERE id = ? AND used_at IS NULL', now, i.id);
    if (claimed.meta.changes !== 1) throw new ApiError(404, 'invite_invalid');

    let memberId: string;
    if (kind === 'join') {
      memberId = newId();
      const stmts = [
        c.env.DB.prepare('INSERT INTO member (id, family_id, role, name, theme, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
          memberId,
          i.family_id,
          i.role,
          b.name!,
          i.role === 'child' ? 'kawaii' : NEUTRAL_THEME,
          now,
        ),
      ];
      if (i.role === 'parent') {
        const pw = await hashPassword(b.password!);
        stmts.push(
          c.env.DB.prepare(
            'INSERT INTO parent_login (member_id, email, password_hash, password_salt, password_iterations) VALUES (?, ?, ?, ?, ?)',
          ).bind(memberId, b.email!, pw.hash, pw.salt, pw.iterations),
        );
      }
      try {
        await c.env.DB.batch(stmts);
      } catch (e) {
        if (isUniqueViolation(e)) throw conflict('email_taken');
        throw e;
      }
    } else {
      memberId = i.member_id!;
      await revokeMemberSessions(c.env.DB, memberId, now);
      if (kind === 'reset') {
        const pw = await hashPassword(b.password!);
        await run(
          c.env.DB,
          'UPDATE parent_login SET password_hash = ?, password_salt = ?, password_iterations = ? WHERE member_id = ?',
          pw.hash,
          pw.salt,
          pw.iterations,
          memberId,
        );
      }
    }
    const { token } = await createSession(c.env.DB, memberId, now);
    return c.json(await sessionResponse(c.env, new URL(c.req.url).origin, memberId, token), 201);
  });

export const invites = new Hono<AppBindings>()
  .post('/invites', requireParent, async (c) => {
    const b = await body(c, createInviteBody);
    const auth = c.get('auth');
    const { familyId, memberId: createdBy } = auth;
    // Every adult can invite children and adults; another adult's password reset is the administrator's.
    if (b.role === 'parent' && b.memberId && b.memberId !== createdBy) await assertFamilyAdmin(c.env.DB, auth);
    let memberName: string | null = null;
    if (b.memberId) {
      const m = await first<{ role: string; name: string }>(
        c.env.DB,
        'SELECT role, name FROM member WHERE id = ? AND family_id = ? AND removed_at IS NULL',
        b.memberId,
        familyId,
      );
      if (!m) throw notFound('member_not_found');
      if (m.role !== b.role) throw badRequest('role_mismatch');
      memberName = m.name;
    }
    const now = Date.now();
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    // Replace this adult's own earlier pending code for the same purpose; other adults' codes stay valid.
    await run(
      c.env.DB,
      'DELETE FROM invite WHERE family_id = ? AND created_by = ? AND used_at IS NULL AND role = ? AND member_id IS ?',
      familyId,
      createdBy,
      b.role,
      b.memberId ?? null,
    );
    for (let attempt = 0; ; attempt++) {
      const code = sixDigitCode();
      try {
        const id = newId();
        await run(
          c.env.DB,
          `INSERT INTO invite (id, family_id, role, member_id, code_hash, token_hash, created_by, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          familyId,
          b.role,
          b.memberId ?? null,
          await sha256Hex(code),
          tokenHash,
          createdBy,
          now,
          now + INVITE_TTL_MS,
        );
        const dto: InviteDto = {
          id,
          role: b.role,
          memberId: b.memberId ?? null,
          memberName,
          code,
          token,
          qr: `choreapp://join?t=${token}`,
          expiresAt: now + INVITE_TTL_MS,
          now,
        };
        return c.json(dto, 201);
      } catch (e) {
        // A code collision with another pending or old invite: draw again.
        if (!isUniqueViolation(e) || attempt >= 5) throw e;
      }
    }
  })

  .get('/invites', requireParent, async (c) => {
    const rows = await all<{ id: string; role: 'parent' | 'child'; member_id: string | null; member_name: string | null; expires_at: number }>(
      c.env.DB,
      `SELECT i.id, i.role, i.member_id, m.name AS member_name, i.expires_at
         FROM invite i LEFT JOIN member m ON m.id = i.member_id
        WHERE i.family_id = ? AND i.used_at IS NULL AND i.expires_at > ?
        ORDER BY i.created_at DESC`,
      c.get('auth').familyId,
      Date.now(),
    );
    const dto: InviteSummaryDto[] = rows.map((r) => ({
      id: r.id,
      role: r.role,
      memberId: r.member_id,
      memberName: r.member_name,
      expiresAt: r.expires_at,
    }));
    return c.json(dto);
  })

  /** Polled by the sheet showing the code: has the other phone used it? */
  .get('/invites/:id', requireParent, async (c) => {
    const i = await first<{ used_at: number | null; expires_at: number }>(
      c.env.DB,
      'SELECT used_at, expires_at FROM invite WHERE id = ? AND family_id = ?',
      c.req.param('id'),
      c.get('auth').familyId,
    );
    const dto: InviteStatusDto = { status: i?.used_at ? 'used' : i && i.expires_at > Date.now() ? 'pending' : 'gone' };
    return c.json(dto);
  })

  /** Revokes an unused code (the sheet was closed). Its creator or the family administrator only. */
  .delete('/invites/:id', requireParent, async (c) => {
    const auth = c.get('auth');
    const i = await first<{ id: string; created_by: string }>(
      c.env.DB,
      'SELECT id, created_by FROM invite WHERE id = ? AND family_id = ?',
      c.req.param('id'),
      auth.familyId,
    );
    if (!i) throw notFound();
    if (i.created_by !== auth.memberId && !(await isFamilyAdmin(c.env.DB, auth))) throw forbidden();
    await run(c.env.DB, 'DELETE FROM invite WHERE id = ? AND used_at IS NULL', i.id);
    return c.json({ ok: true });
  });

/** Cron housekeeping: used or expired invites older than a day. */
export async function cleanupInvites(db: D1Database, now = Date.now()): Promise<void> {
  await run(db, 'DELETE FROM invite WHERE expires_at < ?', now - 86_400_000);
  await run(db, 'DELETE FROM rate_limit WHERE window_start < ?', now - 86_400_000);
}
