/**
 * The agenda: occurrences in a date range (plus anything still overdue) with
 * each assigned child's state computed from completions and the clock.
 */
import { childState, latestCompletion, type CompletionRecord, type LocalDate } from '@choreapp/core';
import type { AgendaChildDto, AgendaItemDto } from '@choreapp/shared';
import { all, allIn } from '../lib/db.js';
import type { FamilyRow } from '../lib/rows.js';
import { ensureFamilyOccurrences } from './occurrences.js';

export interface OccurrenceJoinRow {
  occurrence_id: string;
  date: string;
  task_id: string;
  series_id: string;
  title: string;
  icon: string;
  description: string | null;
  points: number;
  shared_mode: 'each' | 'any';
  due_time: string | null;
  recurrence: string | null;
}

export interface CompletionRow {
  id: string;
  occurrence_id: string;
  member_id: string;
  status: CompletionRecord['status'];
  reported_at: number;
  reviewed_at: number | null;
  reviewed_by: string | null;
  comment: string | null;
}

const OCC_SELECT = `
  SELECT o.id AS occurrence_id, o.date, t.id AS task_id, t.series_id, t.title, t.icon, t.description,
         t.points, t.shared_mode, t.due_time, t.recurrence
    FROM occurrence o JOIN task t ON t.id = o.task_id`;

/** Occurrences before `before` that some assigned child has not finished. */
const OPEN_PAST = `
  ${OCC_SELECT}
   WHERE t.family_id = ? AND o.date < ? AND o.cancelled_at IS NULL
     AND (
       (t.shared_mode = 'any' AND NOT EXISTS (
          SELECT 1 FROM completion c WHERE c.occurrence_id = o.id AND c.status = 'approved'))
       OR (t.shared_mode = 'each' AND EXISTS (
          SELECT 1 FROM task_assignee ta JOIN member m ON m.id = ta.member_id AND m.removed_at IS NULL
           WHERE ta.task_id = t.id AND NOT EXISTS (
             SELECT 1 FROM completion c WHERE c.occurrence_id = o.id AND c.member_id = ta.member_id
               AND c.status IN ('approved', 'closed'))))
     )`;

export interface AgendaOptions {
  from: LocalDate;
  to: LocalDate;
  today: LocalDate;
  now: number;
  /** Only this child's occurrences and state. */
  memberId?: string;
  /** Also return unfinished occurrences from before `from`. */
  includeOverdue?: boolean;
}

export async function loadCompletions(db: D1Database, occurrenceIds: string[]): Promise<CompletionRow[]> {
  return allIn<CompletionRow>(
    db,
    (ph) => `SELECT id, occurrence_id, member_id, status, reported_at, reviewed_at, reviewed_by, comment
               FROM completion WHERE occurrence_id IN (${ph})`,
    occurrenceIds,
  );
}

export async function buildAgenda(db: D1Database, family: FamilyRow, opts: AgendaOptions): Promise<AgendaItemDto[]> {
  await ensureFamilyOccurrences(db, family.id, opts.today, opts.from, opts.to);

  const memberFilter = opts.memberId ? ' AND EXISTS (SELECT 1 FROM task_assignee ta WHERE ta.task_id = t.id AND ta.member_id = ?)' : '';
  const memberArgs = opts.memberId ? [opts.memberId] : [];
  const inRange = await all<OccurrenceJoinRow>(
    db,
    `${OCC_SELECT} WHERE t.family_id = ? AND o.date BETWEEN ? AND ? AND o.cancelled_at IS NULL${memberFilter}`,
    family.id,
    opts.from,
    opts.to,
    ...memberArgs,
  );
  const past = opts.includeOverdue ? await all<OccurrenceJoinRow>(db, `${OPEN_PAST}${memberFilter}`, family.id, opts.from, ...memberArgs) : [];
  const rows = [...past, ...inRange];
  if (rows.length === 0) return [];

  const taskIds = [...new Set(rows.map((r) => r.task_id))];
  const [assignees, completions, children] = await Promise.all([
    allIn<{ task_id: string; member_id: string }>(db, (ph) => `SELECT task_id, member_id FROM task_assignee WHERE task_id IN (${ph})`, taskIds),
    loadCompletions(
      db,
      rows.map((r) => r.occurrence_id),
    ),
    all<{ id: string }>(db, "SELECT id FROM member WHERE family_id = ? AND role = 'child' AND removed_at IS NULL", family.id),
  ]);
  const activeChildren = new Set(children.map((c) => c.id));

  const items: AgendaItemDto[] = [];
  for (const r of rows) {
    let kids = assignees.filter((a) => a.task_id === r.task_id && activeChildren.has(a.member_id)).map((a) => a.member_id);
    if (opts.memberId) kids = kids.filter((k) => k === opts.memberId);
    if (kids.length === 0) continue;
    const occCompletions = completions.filter((c) => c.occurrence_id === r.occurrence_id);
    const approvedBy = occCompletions.filter((c) => c.status === 'approved').map((c) => c.member_id);

    const childDtos: AgendaChildDto[] = kids.map((memberId) => {
      const own = occCompletions.filter((c) => c.member_id === memberId);
      const records: CompletionRecord[] = own.map((c) => ({
        memberId: c.member_id,
        status: c.status,
        reportedAt: c.reported_at,
        reviewedAt: c.reviewed_at,
        comment: c.comment,
      }));
      const s = childState({
        date: r.date,
        dueTime: r.due_time,
        tz: family.timezone,
        now: opts.now,
        own: records,
        closedBySibling: r.shared_mode === 'any' && approvedBy.some((m) => m !== memberId),
      });
      const latest = latestCompletion(own.map((c) => ({ ...c, memberId: c.member_id, reportedAt: c.reported_at })));
      return {
        memberId,
        state: s.state,
        canReport: s.canReport,
        completionId: latest?.id ?? null,
        reportedAt: latest && latest.status !== 'rejected' ? latest.reported_at : null,
        rejection: s.rejection,
      };
    });

    // Past days only show while something is still open for the shown children.
    if (r.date < opts.from && !childDtos.some((c) => c.state === 'overdue' || c.state === 'reported')) continue;

    items.push({
      occurrenceId: r.occurrence_id,
      taskId: r.task_id,
      seriesId: r.series_id,
      date: r.date,
      title: r.title,
      icon: r.icon,
      description: r.description,
      points: r.points,
      sharedMode: r.shared_mode,
      dueTime: r.due_time,
      recurring: r.recurrence !== null,
      children: childDtos,
    });
  }
  items.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99') ||
      a.title.localeCompare(b.title, 'pl'),
  );
  return items;
}
