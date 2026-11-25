/**
 * Notifications. Every notification goes through the outbox:
 *  - outside quiet hours it is delivered right away,
 *  - inside quiet hours it waits until they end, and everything that waited
 *    for a member is sent as one summary notification in the morning.
 * The cron delivers whatever is due.
 */
import { isQuietAt, quietEndsAt } from '@choreapp/core';
import type { DropResultDto } from '@choreapp/shared';
import type { Env } from '../env.js';
import { newId } from '../lib/crypto.js';
import { all, allIn, first, placeholders, run } from '../lib/db.js';
import type { FamilyRow } from '../lib/rows.js';
import type { PendingCompletion } from './approval.js';
import { sendPush, type PushMessage } from './fcm.js';

export type NotificationType = 'task_new' | 'reminder' | 'report' | 'approved' | 'rejected' | 'reward';

export interface Notification {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface OutboxRow {
  id: string;
  member_id: string;
  type: string;
  title: string;
  body: string;
  data: string | null;
  created_at: number;
  deliver_after: number;
}

export async function enqueue(env: Env, family: FamilyRow, memberIds: string[], n: Notification, now = Date.now()): Promise<void> {
  if (memberIds.length === 0) return;
  const deliverAfter = quietEndsAt(now, family.timezone, family.quiet_from, family.quiet_to);
  await env.DB.batch(
    memberIds.map((m) =>
      env.DB.prepare(
        'INSERT INTO notification_outbox (id, member_id, type, title, body, data, created_at, deliver_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(newId(), m, n.type, n.title, n.body, n.data ? JSON.stringify(n.data) : null, now, deliverAfter),
    ),
  );
  if (!isQuietAt(now, family.timezone, family.quiet_from, family.quiet_to)) await deliverDue(env, now, memberIds);
}

/**
 * Quiet hours changed (shortened or switched off): held notifications follow the
 * new window, so the next cron run sends whatever is no longer quiet.
 */
export async function rescheduleHeld(env: Env, family: FamilyRow, now = Date.now()): Promise<void> {
  await run(
    env.DB,
    `UPDATE notification_outbox SET deliver_after = ?
      WHERE sent_at IS NULL AND deliver_after > ? AND member_id IN (SELECT id FROM member WHERE family_id = ?)`,
    quietEndsAt(now, family.timezone, family.quiet_from, family.quiet_to),
    now,
    family.id,
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const last = n % 10;
  const lastTwo = n % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
}

/** One message per member: the notification itself, or a summary of what waited overnight. */
export function composeForMember(rows: OutboxRow[]): PushMessage {
  if (rows.length === 1 && rows[0]!.deliver_after === rows[0]!.created_at) {
    const r = rows[0]!;
    return { title: r.title, body: r.body, data: { type: r.type, ...(r.data ? JSON.parse(r.data) : {}) } };
  }
  const titles = rows.map((r) => r.title);
  const shown = titles.slice(0, 3).join(' · ');
  return {
    title: `Masz ${rows.length} ${plural(rows.length, 'powiadomienie', 'powiadomienia', 'powiadomień')}`,
    body: titles.length > 3 ? `${shown} i więcej` : shown,
    data: { type: 'digest' },
    tag: 'digest',
  };
}

/** Delivers due outbox rows (optionally only for some members). */
export async function deliverDue(env: Env, now = Date.now(), memberIds?: string[]): Promise<number> {
  const rows = memberIds
    ? await allIn<OutboxRow>(
        env.DB,
        (ph) => `SELECT * FROM notification_outbox WHERE member_id IN (${ph}) AND sent_at IS NULL AND deliver_after <= ? ORDER BY created_at`,
        memberIds,
        now,
      )
    : await all<OutboxRow>(env.DB, 'SELECT * FROM notification_outbox WHERE sent_at IS NULL AND deliver_after <= ? ORDER BY created_at', now);
  if (rows.length === 0) return 0;

  const byMember = new Map<string, OutboxRow[]>();
  for (const r of rows) byMember.set(r.member_id, [...(byMember.get(r.member_id) ?? []), r]);

  // Mark first so an overlapping cron run can't send twice.
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    await run(env.DB, `UPDATE notification_outbox SET sent_at = ? WHERE sent_at IS NULL AND id IN (${placeholders(chunk.length)})`, now, ...chunk);
  }

  const devices = await allIn<{ member_id: string; push_token: string }>(
    env.DB,
    (ph) => `SELECT member_id, push_token FROM device WHERE member_id IN (${ph})`,
    [...byMember.keys()],
  );
  let sent = 0;
  for (const [memberId, memberRows] of byMember) {
    const tokens = devices.filter((d) => d.member_id === memberId).map((d) => d.push_token);
    if (tokens.length === 0) continue;
    const results = await sendPush(env, tokens, composeForMember(memberRows), now);
    const invalid = [...results].filter(([, r]) => r === 'invalid_token').map(([t]) => t);
    if (invalid.length > 0) await run(env.DB, `DELETE FROM device WHERE push_token IN (${placeholders(invalid.length)})`, ...invalid);
    sent += [...results.values()].filter((r) => r === 'ok').length;
  }
  return sent;
}

async function parentIds(env: Env, familyId: string): Promise<string[]> {
  return (await all<{ id: string }>(env.DB, "SELECT id FROM member WHERE family_id = ? AND role = 'parent' AND removed_at IS NULL", familyId)).map(
    (r) => r.id,
  );
}

async function memberName(env: Env, id: string): Promise<string> {
  return (await first<{ name: string }>(env.DB, 'SELECT name FROM member WHERE id = ?', id))?.name ?? '';
}

// ---------------------------------------------------------------------------
// The events from the spec
// ---------------------------------------------------------------------------

export async function notifyNewTask(env: Env, family: FamilyRow, childIds: string[], title: string, now = Date.now()): Promise<void> {
  await enqueue(env, family, childIds, { type: 'task_new', title: 'Nowe zadanie', body: title, data: { screen: 'today' } }, now);
}

export async function notifyParentsOfReport(env: Env, family: FamilyRow, childId: string, title: string, completionId: string, now = Date.now()): Promise<void> {
  const name = await memberName(env, childId);
  await enqueue(
    env,
    family,
    await parentIds(env, family.id),
    { type: 'report', title: `${name}: zrobione!`, body: `${title}. Sprawdź i zatwierdź.`, data: { screen: 'approvals', completionId } },
    now,
  );
}

export async function notifyReviewed(
  env: Env,
  family: FamilyRow,
  c: PendingCompletion,
  approved: boolean,
  comment: string | null,
  drop: DropResultDto | null,
  now = Date.now(),
): Promise<void> {
  const n: Notification = approved
    ? {
        type: 'approved',
        title: `Zatwierdzone! +${c.points} pkt`,
        body: drop && (drop.items.length > 0 || drop.streakPack) ? `${c.title} · masz nową naklejkę!` : c.title,
        data: { screen: drop && drop.items.length > 0 ? 'collection' : 'points' },
      }
    : { type: 'rejected', title: `Do poprawki: ${c.title}`, body: comment ?? 'Rodzic prosi, żeby to poprawić.', data: { screen: 'today' } };
  await enqueue(env, family, [c.member_id], n, now);
}

export async function notifyRewardChosen(env: Env, family: FamilyRow, childId: string, reward: string, cost: number, now = Date.now()): Promise<void> {
  const name = await memberName(env, childId);
  await enqueue(
    env,
    family,
    await parentIds(env, family.id),
    { type: 'reward', title: `${name} wybiera nagrodę`, body: `${reward} (${cost} pkt). Oznacz, gdy ją wydasz.`, data: { screen: 'rewards' } },
    now,
  );
}

export async function notifyReminder(env: Env, family: FamilyRow, childId: string, left: number, now = Date.now()): Promise<void> {
  await enqueue(
    env,
    family,
    [childId],
    {
      type: 'reminder',
      title: 'Zadania na dziś',
      body: `${left === 1 ? 'Zostało Ci jedno zadanie' : `Zostały Ci ${left} ${plural(left, 'zadanie', 'zadania', 'zadań')}`}. Dasz radę!`,
      data: { screen: 'today' },
    },
    now,
  );
}
