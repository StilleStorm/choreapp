/**
 * The single cron trigger (every 5 minutes). Each step is cheap and
 * idempotent, so a missed or repeated run does no harm:
 *  1. keep occurrences generated two weeks ahead,
 *  2. send the daily reminder to children with unfinished tasks,
 *  3. deliver notifications held back by quiet hours (one digest each),
 *  4. hourly housekeeping.
 */
import { addDays, localDateAt, reminderDue } from '@choreapp/core';
import type { Env } from '../env.js';
import { all, run } from '../lib/db.js';
import type { FamilyRow } from '../lib/rows.js';
import { cleanupInvites } from '../routes/invites.js';
import { cleanupPasswordResets } from '../routes/passwordReset.js';
import { buildAgenda } from './agenda.js';
import { deliverDue, notifyReminder } from './notify.js';
import { HORIZON_DAYS, ensureFamilyOccurrences } from './occurrences.js';

export async function sendReminders(env: Env, family: FamilyRow, now: number): Promise<number> {
  const today = localDateAt(now, family.timezone);
  const children = await all<{ id: string; last_reminder_date: string | null }>(
    env.DB,
    "SELECT id, last_reminder_date FROM member WHERE family_id = ? AND role = 'child' AND removed_at IS NULL",
    family.id,
  );
  let sent = 0;
  for (const child of children) {
    if (!reminderDue(now, family.timezone, family.reminder_time, child.last_reminder_date)) continue;
    // Mark first: a slow or failing push must not cause a second reminder.
    await run(env.DB, 'UPDATE member SET last_reminder_date = ? WHERE id = ?', today, child.id);
    const items = await buildAgenda(env.DB, family, { from: today, to: today, today, now, memberId: child.id, includeOverdue: true });
    const open = items.filter((i) => i.children.some((c) => c.state === 'todo' || c.state === 'overdue')).length;
    if (open === 0) continue;
    await notifyReminder(env, family, child.id, open, now);
    sent++;
  }
  return sent;
}

export async function runCron(env: Env, now = Date.now()): Promise<void> {
  const families = await all<FamilyRow>(env.DB, 'SELECT * FROM family');
  for (const family of families) {
    const today = localDateAt(now, family.timezone);
    await ensureFamilyOccurrences(env.DB, family.id, today, today, addDays(today, HORIZON_DAYS));
    await sendReminders(env, family, now);
  }
  await deliverDue(env, now);
  if (new Date(now).getUTCMinutes() < 5) {
    await cleanupInvites(env.DB, now);
    await cleanupPasswordResets(env.DB, now);
    // Keep the outbox small: delivered notifications older than a month.
    await run(env.DB, 'DELETE FROM notification_outbox WHERE sent_at IS NOT NULL AND sent_at < ?', now - 30 * 86_400_000);
  }
}
