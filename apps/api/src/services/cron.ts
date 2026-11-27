/**
 * The single cron trigger (every 5 minutes). Each step is cheap and
 * idempotent, so a missed or repeated run does no harm:
 *  1. once per family-local day, top up the two-week occurrence horizon,
 *  2. once per family-local day, after the reminder time, remind children
 *     with unfinished tasks,
 *  3. deliver notifications held back by quiet hours (one digest each),
 *  4. hourly housekeeping.
 *
 * Steps 1-2 are tracked per family (family.occ_through_date / reminder_date),
 * so a family with nothing left to do today costs no queries beyond the one
 * that lists families. A D1 query budget caps each run; families left over
 * are picked up 5 minutes later, due reminders first, oldest first.
 * Occurrences never depend on this cron for correctness: creating or editing
 * a task generates its own two weeks, and every agenda read fills its range.
 */
import { addDays, localDateAt, reminderDue, zonedToEpoch, type LocalDate } from '@choreapp/core';
import type { Env } from '../env.js';
import { all, run } from '../lib/db.js';
import type { FamilyRow } from '../lib/rows.js';
import { cleanupInvites } from '../routes/invites.js';
import { cleanupPasswordResets } from '../routes/passwordReset.js';
import { buildAgenda } from './agenda.js';
import { deliverDue, notifyReminder } from './notify.js';
import { HORIZON_DAYS, activeTasksInRange, ensureOccurrences } from './occurrences.js';

/**
 * D1 statements the per-family work may use in one run. Workers Paid allows
 * 1000 queries per invocation; the rest is headroom for the family in
 * progress when the budget runs out, deliverDue and housekeeping.
 */
export const FAMILY_QUERY_BUDGET = 600;

/** The family columns the cron needs (enough for buildAgenda and enqueue). */
type CronFamily = Pick<
  FamilyRow,
  'id' | 'timezone' | 'quiet_from' | 'quiet_to' | 'reminder_time' | 'occ_through_date' | 'reminder_date'
>;

export async function sendReminders(env: Env, family: CronFamily, now: number): Promise<number> {
  const today = localDateAt(now, family.timezone);
  const children = await all<{ id: string; last_reminder_date: string | null }>(
    env.DB,
    "SELECT id, last_reminder_date FROM member WHERE family_id = ? AND role = 'child' AND removed_at IS NULL",
    family.id,
  );
  const due = children.filter((c) => reminderDue(now, family.timezone, family.reminder_time, c.last_reminder_date)).map((c) => c.id);
  if (due.length === 0) return 0;
  // Mark first: a slow or failing push must not cause a second reminder.
  // (A family has far fewer than D1's 100 bound parameters of children.)
  await run(env.DB, `UPDATE member SET last_reminder_date = ? WHERE id IN (${due.map(() => '?').join(', ')})`, today, ...due);
  // One agenda for the whole family; each child's states are the same as in a per-child agenda.
  const fam = family as FamilyRow;
  const items = await buildAgenda(env.DB, fam, { from: today, to: today, today, now, includeOverdue: true });
  let sent = 0;
  for (const childId of due) {
    const open = items.filter((i) => i.children.some((c) => c.memberId === childId && (c.state === 'todo' || c.state === 'overdue'))).length;
    if (open === 0) continue;
    await notifyReminder(env, fam, childId, open, now);
    sent++;
  }
  return sent;
}

/**
 * Daily top-up of the horizon. After yesterday's top-up everything up to
 * yesterday + 14 exists (task writes generate their own days), so normally
 * only the one day entering the horizon is new.
 */
export async function topUpOccurrences(db: D1Database, familyId: string, today: LocalDate, lastTopUp: LocalDate | null | undefined): Promise<void> {
  const to = addDays(today, HORIZON_DAYS);
  const covered = lastTopUp && lastTopUp <= today ? addDays(lastTopUp, HORIZON_DAYS + 1) : today;
  const from = covered > today ? covered : today;
  if (from > to) return;
  await ensureOccurrences(db, await activeTasksInRange(db, familyId, from, to), from, to);
}

/** A D1 binding that counts prepared statements (each one is executed once). */
function countingDb(db: D1Database, counter: { queries: number }): D1Database {
  return {
    prepare: (sql: string) => {
      counter.queries++;
      return db.prepare(sql);
    },
    batch: (stmts: D1PreparedStatement[]) => db.batch(stmts),
    exec: (sql: string) => {
      counter.queries++;
      return db.exec(sql);
    },
    withSession: (c?: string) => db.withSession(c),
    dump: () => db.dump(),
  } as D1Database;
}

interface Work {
  family: CronFamily;
  today: LocalDate;
  occ: boolean;
  remind: boolean;
  /** Sort key: when the work became due (epoch ms). */
  since: number;
}

export interface CronResult {
  /** Families that had work today and were handled in this run. */
  processed: number;
  /** Families left for the next run because the budget ran out. */
  deferred: number;
  /** Families whose work threw (retried next run). */
  failed: number;
  /** D1 statements used by the per-family work. */
  queries: number;
}

export async function runCron(env: Env, now = Date.now(), opts: { budget?: number } = {}): Promise<CronResult> {
  const budget = opts.budget ?? FAMILY_QUERY_BUDGET;
  const families = await all<CronFamily>(
    env.DB,
    'SELECT id, timezone, quiet_from, quiet_to, reminder_time, occ_through_date, reminder_date FROM family',
  );
  const result: CronResult = { processed: 0, deferred: 0, failed: 0, queries: 0 };

  const work: Work[] = [];
  for (const family of families) {
    try {
      const today = localDateAt(now, family.timezone);
      const occ = family.occ_through_date !== today;
      const remind = reminderDue(now, family.timezone, family.reminder_time, family.reminder_date ?? null);
      if (!occ && !remind) continue;
      const since = remind ? zonedToEpoch(today, family.reminder_time, family.timezone) : zonedToEpoch(today, '00:00', family.timezone);
      work.push({ family, today, occ, remind, since });
    } catch (e) {
      result.failed++;
      console.error('cron: bad family settings', family.id, e);
    }
  }
  // Due reminders first (they are time-sensitive), then occurrence top-ups; oldest first within each.
  work.sort((a, b) => Number(b.remind) - Number(a.remind) || a.since - b.since);

  const counter = { queries: 0 };
  const cenv: Env = { ...env, DB: countingDb(env.DB, counter) };
  for (const [i, w] of work.entries()) {
    if (counter.queries >= budget) {
      result.deferred = work.length - i;
      break;
    }
    let occDone: LocalDate | null = null;
    let remindDone: LocalDate | null = null;
    let ok = true;
    if (w.occ) {
      try {
        await topUpOccurrences(cenv.DB, w.family.id, w.today, w.family.occ_through_date);
        occDone = w.today;
      } catch (e) {
        ok = false;
        console.error('cron: occurrences failed', w.family.id, e);
      }
    }
    if (w.remind) {
      try {
        await sendReminders(cenv, w.family, now);
        remindDone = w.today;
      } catch (e) {
        ok = false;
        console.error('cron: reminders failed', w.family.id, e);
      }
    }
    if (occDone || remindDone) {
      try {
        await run(
          cenv.DB,
          'UPDATE family SET occ_through_date = COALESCE(?, occ_through_date), reminder_date = COALESCE(?, reminder_date) WHERE id = ?',
          occDone,
          remindDone,
          w.family.id,
        );
      } catch (e) {
        ok = false;
        console.error('cron: marker update failed', w.family.id, e);
      }
    }
    if (ok) result.processed++;
    else result.failed++;
  }
  result.queries = counter.queries;

  await deliverDue(env, now);
  if (new Date(now).getUTCMinutes() < 5) {
    await cleanupInvites(env.DB, now);
    await cleanupPasswordResets(env.DB, now);
    // Keep the outbox small: delivered notifications older than a month.
    await run(env.DB, 'DELETE FROM notification_outbox WHERE sent_at IS NOT NULL AND sent_at < ?', now - 30 * 86_400_000);
  }
  return result;
}
