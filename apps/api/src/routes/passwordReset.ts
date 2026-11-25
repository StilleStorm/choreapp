/**
 * Forgotten password, adults only (children have no e-mail). A 6-digit code is
 * e-mailed, valid 15 minutes, single use; only its hash is stored. The answer to
 * /auth/forgot never tells whether the e-mail has an account.
 */
import { forgotPasswordBody, resetPasswordBody } from '@choreapp/shared';
import { Hono } from 'hono';
import type { AppBindings } from '../env.js';
import { clientIp, createSession, revokeMemberSessions } from '../lib/auth.js';
import { hashPassword, newId, sha256Hex, sixDigitCode, timingSafeEqual } from '../lib/crypto.js';
import { first, hit, isLimited, run } from '../lib/db.js';
import { passwordResetEmail } from '../lib/email.js';
import { ApiError, badRequest, body } from '../lib/http.js';
import { sessionResponse } from './account.js';

export const RESET_TTL_MS = 15 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
const FAIL_WINDOW = 15 * 60_000;
const FAIL_LIMIT = 10;

async function findAdult(db: D1Database, email: string): Promise<string | null> {
  const row = await first<{ member_id: string }>(
    db,
    `SELECT pl.member_id FROM parent_login pl JOIN member m ON m.id = pl.member_id
      WHERE pl.email = ? AND m.role = 'parent' AND m.removed_at IS NULL`,
    email,
  );
  return row?.member_id ?? null;
}

export const passwordReset = new Hono<AppBindings>()
  .post('/auth/forgot', async (c) => {
    const b = await body(c, forgotPasswordBody);
    // Counted for every e-mail, known or not, so limits reveal nothing either.
    const ipOk = await hit(c.env.DB, `forgot-ip:${clientIp(c.req.raw)}`, 10, 15 * 60_000);
    const emailOk = ipOk && (await hit(c.env.DB, `forgot-email:${b.email}`, 3, 60 * 60_000));
    if (!ipOk || !emailOk) throw new ApiError(429, 'too_many_attempts');

    const memberId = await findAdult(c.env.DB, b.email);
    if (memberId) {
      const now = Date.now();
      const code = sixDigitCode();
      await c.env.DB.batch([
        // A new code replaces any earlier one.
        c.env.DB.prepare('DELETE FROM password_reset WHERE member_id = ? AND used_at IS NULL').bind(memberId),
        c.env.DB.prepare(
          'INSERT INTO password_reset (id, member_id, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        ).bind(newId(), memberId, await sha256Hex(code), now, now + RESET_TTL_MS),
      ]);
      try {
        await c.env.EMAIL.send(passwordResetEmail(b.email, code));
      } catch (e) {
        console.error('password reset e-mail failed', (e as { code?: string }).code, e);
      }
    }
    return c.json({ ok: true });
  })

  .post('/auth/reset', async (c) => {
    const b = await body(c, resetPasswordBody);
    const failKey = `reset-fail:${clientIp(c.req.raw)}`;
    if (await isLimited(c.env.DB, failKey, FAIL_LIMIT, FAIL_WINDOW)) throw new ApiError(429, 'too_many_attempts');
    const now = Date.now();
    const memberId = await findAdult(c.env.DB, b.email);
    const reset = memberId
      ? await first<{ id: string; code_hash: string; attempts: number }>(
          c.env.DB,
          `SELECT id, code_hash, attempts FROM password_reset
            WHERE member_id = ? AND used_at IS NULL AND expires_at > ?
            ORDER BY created_at DESC LIMIT 1`,
          memberId,
          now,
        )
      : null;
    const ok = !!reset && timingSafeEqual(reset.code_hash, await sha256Hex(b.code));
    if (!ok) {
      await hit(c.env.DB, failKey, 1_000_000, FAIL_WINDOW);
      if (reset) {
        // Too many wrong tries burn the code.
        await run(
          c.env.DB,
          'UPDATE password_reset SET attempts = attempts + 1, used_at = CASE WHEN attempts + 1 >= ? THEN ? ELSE used_at END WHERE id = ?',
          MAX_CODE_ATTEMPTS,
          now,
          reset.id,
        );
      }
      throw badRequest('reset_code_invalid');
    }

    // Single use, even under concurrent requests.
    const claimed = await run(c.env.DB, 'UPDATE password_reset SET used_at = ? WHERE id = ? AND used_at IS NULL', now, reset.id);
    if (claimed.meta.changes !== 1) throw badRequest('reset_code_invalid');

    const pw = await hashPassword(b.newPassword);
    await run(
      c.env.DB,
      'UPDATE parent_login SET password_hash = ?, password_salt = ?, password_iterations = ? WHERE member_id = ?',
      pw.hash,
      pw.salt,
      pw.iterations,
      memberId!,
    );
    await revokeMemberSessions(c.env.DB, memberId!, now);
    const { token } = await createSession(c.env.DB, memberId!, now);
    return c.json(await sessionResponse(c.env, new URL(c.req.url).origin, memberId!, token));
  });

/** Cron housekeeping: reset codes a day past expiry. */
export async function cleanupPasswordResets(db: D1Database, now = Date.now()): Promise<void> {
  await run(db, 'DELETE FROM password_reset WHERE expires_at < ?', now - 86_400_000);
}
