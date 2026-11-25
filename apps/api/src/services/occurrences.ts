/**
 * Occurrence generation. Rules live on `task`; concrete days live in
 * `occurrence` so completions can point at them. The cron keeps a rolling
 * horizon filled, and every read also fills the range it shows.
 */
import { addDays, expandOccurrences, parseRRule, type LocalDate } from '@choreapp/core';
import { newId } from '../lib/crypto.js';
import { all } from '../lib/db.js';
import type { TaskRow } from '../lib/rows.js';

export const HORIZON_DAYS = 14;

/** Inserts missing occurrences of the given tasks within [from, to]. */
export async function ensureOccurrences(db: D1Database, tasks: readonly TaskRow[], from: LocalDate, to: LocalDate): Promise<number> {
  if (from > to) return 0;
  const stmts: D1PreparedStatement[] = [];
  for (const t of tasks) {
    if (t.archived_at) continue;
    const dates = expandOccurrences(
      { recurrence: parseRRule(t.recurrence), startDate: t.start_date, endDate: t.end_date },
      from,
      to,
    );
    for (const d of dates) {
      stmts.push(db.prepare('INSERT OR IGNORE INTO occurrence (id, task_id, date) VALUES (?, ?, ?)').bind(newId(), t.id, d));
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return stmts.length;
}

export async function activeTasksInRange(db: D1Database, familyId: string, from: LocalDate, to: LocalDate): Promise<TaskRow[]> {
  return all<TaskRow>(
    db,
    `SELECT * FROM task
      WHERE family_id = ? AND archived_at IS NULL AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)`,
    familyId,
    to,
    from,
  );
}

/**
 * Fills occurrences for the family in [from, to], never before `today`:
 * past days were generated while they were in the future (one-off tasks
 * created for a past day are generated when created).
 */
export async function ensureFamilyOccurrences(db: D1Database, familyId: string, today: LocalDate, from: LocalDate, to: LocalDate): Promise<void> {
  const lo = from < today ? today : from;
  if (lo > to) return;
  await ensureOccurrences(db, await activeTasksInRange(db, familyId, lo, to), lo, to);
}

/** Generates occurrences for a newly created or edited task. */
export async function generateForTask(db: D1Database, task: TaskRow, today: LocalDate): Promise<void> {
  const from = task.recurrence === null ? task.start_date : task.start_date > today ? task.start_date : today;
  await ensureOccurrences(db, [task], from, addDays(today, HORIZON_DAYS));
}
