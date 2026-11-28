/**
 * Account deletion. Rows are really deleted (not soft-removed), together with
 * the member's photo in R2, so nothing personal is left behind.
 */
import type { Env } from '../env.js';
import { all, first } from '../lib/db.js';

/** Rate-limit counters keyed by the member id or their e-mail (see account.ts, passwordReset.ts). */
function rateLimitKeys(memberId: string, email: string | null): string[] {
  const keys = [`pw-check:${memberId}`, `email-change:${memberId}`];
  if (email) keys.push(`login-email:${email}`, `forgot-email:${email}`);
  return keys;
}

/**
 * Deletes one member and everything that is theirs: points, stickers, reports,
 * reward requests, phones, sessions, codes. Where an adult appears only as the
 * actor (reviewed a report, delivered a reward, created a task) the reference
 * is cleared or handed to the family administrator. The administrator
 * themselves can only be deleted with the whole family.
 */
export async function eraseMember(env: Env, memberId: string): Promise<void> {
  const db = env.DB;
  const m = await first<{ family_id: string; avatar_key: string | null; email: string | null }>(
    db,
    `SELECT m.family_id, m.avatar_key, pl.email FROM member m
       LEFT JOIN parent_login pl ON pl.member_id = m.id WHERE m.id = ?`,
    memberId,
  );
  if (!m) return;
  const keys = rateLimitKeys(memberId, m.email);
  const s = (sql: string, ...args: string[]) => db.prepare(sql).bind(...args);
  await db.batch([
    s('DELETE FROM points_ledger WHERE member_id = ?', memberId),
    s('DELETE FROM streak_award WHERE member_id = ?', memberId),
    s('DELETE FROM member_item WHERE member_id = ?', memberId),
    s('DELETE FROM completion WHERE member_id = ?', memberId),
    s('DELETE FROM redemption WHERE member_id = ?', memberId),
    s('DELETE FROM task_assignee WHERE member_id = ?', memberId),
    s('DELETE FROM notification_outbox WHERE member_id = ?', memberId),
    s('DELETE FROM device WHERE member_id = ?', memberId),
    s('DELETE FROM session WHERE member_id = ?', memberId),
    s('DELETE FROM password_reset WHERE member_id = ?', memberId),
    s('DELETE FROM invite WHERE member_id = ? OR created_by = ?', memberId, memberId),
    s('DELETE FROM parent_login WHERE member_id = ?', memberId),
    s('UPDATE completion SET reviewed_by = NULL WHERE reviewed_by = ?', memberId),
    s('UPDATE redemption SET resolved_by = NULL WHERE resolved_by = ?', memberId),
    s('UPDATE points_ledger SET created_by = NULL WHERE created_by = ?', memberId),
    s('UPDATE task SET created_by = (SELECT admin_member_id FROM family WHERE id = ?) WHERE created_by = ?', m.family_id, memberId),
    s(`DELETE FROM rate_limit WHERE key IN (${keys.map(() => '?').join(', ')})`, ...keys),
    s('DELETE FROM member WHERE id = ?', memberId),
  ]);
  if (m.avatar_key) await env.FILES.delete(m.avatar_key);
}

/** Deletes a family with all its members, tasks, rewards, packs and files. */
export async function eraseFamily(env: Env, familyId: string): Promise<void> {
  const db = env.DB;
  const members = await all<{ id: string; email: string | null }>(
    db,
    'SELECT m.id, pl.email FROM member m LEFT JOIN parent_login pl ON pl.member_id = m.id WHERE m.family_id = ?',
    familyId,
  );
  const s = (sql: string) => db.prepare(sql).bind(familyId);
  const MEMBERS = '(SELECT id FROM member WHERE family_id = ?)';
  const TASKS = '(SELECT id FROM task WHERE family_id = ?)';
  const PACKS = '(SELECT id FROM pack WHERE family_id = ?)';
  const keys = members.flatMap((m) => rateLimitKeys(m.id, m.email));
  const limitDeletes = [];
  for (let i = 0; i < keys.length; i += 90) {
    const chunk = keys.slice(i, i + 90);
    limitDeletes.push(db.prepare(`DELETE FROM rate_limit WHERE key IN (${chunk.map(() => '?').join(', ')})`).bind(...chunk));
  }
  await db.batch([
    s(`DELETE FROM points_ledger WHERE member_id IN ${MEMBERS}`),
    s(`DELETE FROM streak_award WHERE member_id IN ${MEMBERS}`),
    s(`DELETE FROM member_item WHERE member_id IN ${MEMBERS}`),
    s(`DELETE FROM completion WHERE member_id IN ${MEMBERS}`),
    s(`DELETE FROM occurrence WHERE task_id IN ${TASKS}`),
    s(`DELETE FROM task_assignee WHERE task_id IN ${TASKS}`),
    s('DELETE FROM task WHERE family_id = ?'),
    s(`DELETE FROM redemption WHERE member_id IN ${MEMBERS}`),
    s('DELETE FROM reward WHERE family_id = ?'),
    s(`DELETE FROM item WHERE pack_id IN ${PACKS}`),
    db.prepare(`DELETE FROM pack_setting WHERE family_id = ? OR pack_id IN ${PACKS}`).bind(familyId, familyId),
    s('DELETE FROM pack WHERE family_id = ?'),
    s(`DELETE FROM notification_outbox WHERE member_id IN ${MEMBERS}`),
    s(`DELETE FROM device WHERE member_id IN ${MEMBERS}`),
    s(`DELETE FROM session WHERE member_id IN ${MEMBERS}`),
    s(`DELETE FROM password_reset WHERE member_id IN ${MEMBERS}`),
    s(`DELETE FROM parent_login WHERE member_id IN ${MEMBERS}`),
    s('DELETE FROM invite WHERE family_id = ?'),
    s('UPDATE family SET admin_member_id = NULL WHERE id = ?'),
    s('DELETE FROM member WHERE family_id = ?'),
    s('DELETE FROM family WHERE id = ?'),
    ...limitDeletes,
  ]);
  // Avatars and the family's own pack images all live under one prefix.
  let cursor: string | undefined;
  do {
    const page = await env.FILES.list({ prefix: `families/${familyId}/`, cursor });
    if (page.objects.length > 0) await env.FILES.delete(page.objects.map((o) => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
