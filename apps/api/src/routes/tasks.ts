/**
 * Tasks (series), the agenda and the week grid.
 *
 * Editing a recurring series only changes the future: the current version is
 * ended yesterday (or today, if today's occurrence already has a report) and
 * a new version with the same series_id starts after it. History keeps
 * pointing at the old version, so past points and titles never change.
 */
import {
  addDays,
  diffDays,
  isLocalDate,
  localDateAt,
  startOfIsoWeek,
  toRRule,
  type LocalDate,
  type Recurrence,
} from '@choreapp/core';
import { taskInput, type AgendaDto, type TaskInput, type WeekCellDto, type WeekDto } from '@choreapp/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings, Env } from '../env.js';
import { requireParent } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { all, first, placeholders, run } from '../lib/db.js';
import { background, badRequest, body, conflict, notFound, query } from '../lib/http.js';
import { loadFamily, taskDtos, type FamilyRow, type TaskRow } from '../lib/rows.js';
import { buildAgenda } from '../services/agenda.js';
import { notifyNewTask } from '../services/notify.js';
import { generateForTask } from '../services/occurrences.js';

function todayOf(family: FamilyRow, now = Date.now()): LocalDate {
  return localDateAt(now, family.timezone);
}

async function validateAssignees(env: Env, familyId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  const rows = await all<{ id: string }>(
    env.DB,
    `SELECT id FROM member WHERE family_id = ? AND role = 'child' AND removed_at IS NULL AND id IN (${placeholders(unique.length)})`,
    familyId,
    ...unique,
  );
  if (rows.length !== unique.length) throw badRequest('assignee_not_child');
  return unique;
}

function recurrenceOf(input: TaskInput): Recurrence {
  return input.recurrence as Recurrence;
}

async function loadTask(env: Env, familyId: string, id: string): Promise<TaskRow> {
  const t = await first<TaskRow>(env.DB, 'SELECT * FROM task WHERE id = ? AND family_id = ? AND archived_at IS NULL', id, familyId);
  if (!t) throw notFound('task_not_found');
  return t;
}

/** Deletes occurrences of a task from `from` on that nobody has reported yet. */
async function dropUnreportedOccurrences(db: D1Database, taskId: string, from: LocalDate | null): Promise<void> {
  await run(
    db,
    `DELETE FROM occurrence WHERE task_id = ? ${from ? 'AND date >= ?' : ''}
       AND NOT EXISTS (SELECT 1 FROM completion c WHERE c.occurrence_id = occurrence.id)`,
    ...(from ? [taskId, from] : [taskId]),
  );
}

async function hasCompletions(db: D1Database, taskId: string, date?: LocalDate): Promise<boolean> {
  const row = await first(
    db,
    `SELECT 1 FROM completion c JOIN occurrence o ON o.id = c.occurrence_id WHERE o.task_id = ? ${date ? 'AND o.date = ?' : ''} LIMIT 1`,
    ...(date ? [taskId, date] : [taskId]),
  );
  return !!row;
}

/**
 * Keeps the phase of an "every N weeks" rule when a new version starts
 * mid-series: the new version starts in the next week that was "on".
 */
export function alignWeeklyStart(oldStart: LocalDate, rec: Recurrence, cutoff: LocalDate): LocalDate {
  if (rec.kind !== 'weekly' || rec.interval === 1) return cutoff;
  const weeks = diffDays(startOfIsoWeek(cutoff), startOfIsoWeek(oldStart)) / 7;
  const offset = ((weeks % rec.interval) + rec.interval) % rec.interval;
  return offset === 0 ? cutoff : addDays(startOfIsoWeek(cutoff), (rec.interval - offset) * 7);
}

async function writeTask(env: Env, t: TaskRow, assignees: string[], insert: boolean): Promise<void> {
  const stmts = [
    insert
      ? env.DB.prepare(
          `INSERT INTO task (id, family_id, series_id, title, icon, description, points, shared_mode, start_date, end_date, due_time, recurrence, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          t.id,
          t.family_id,
          t.series_id,
          t.title,
          t.icon,
          t.description,
          t.points,
          t.shared_mode,
          t.start_date,
          t.end_date,
          t.due_time,
          t.recurrence,
          t.created_by,
          t.created_at,
        )
      : env.DB.prepare(
          `UPDATE task SET title = ?, icon = ?, description = ?, points = ?, shared_mode = ?, start_date = ?, end_date = ?, due_time = ?, recurrence = ?
            WHERE id = ?`,
        ).bind(t.title, t.icon, t.description, t.points, t.shared_mode, t.start_date, t.end_date, t.due_time, t.recurrence, t.id),
    env.DB.prepare('DELETE FROM task_assignee WHERE task_id = ?').bind(t.id),
    ...assignees.map((m) => env.DB.prepare('INSERT INTO task_assignee (task_id, member_id) VALUES (?, ?)').bind(t.id, m)),
  ];
  await env.DB.batch(stmts);
}

function rowFromInput(input: TaskInput, assignees: string[], base: Pick<TaskRow, 'id' | 'family_id' | 'series_id' | 'created_by' | 'created_at'>, startDate: LocalDate): TaskRow {
  const recurrence = recurrenceOf(input);
  return {
    ...base,
    title: input.title,
    icon: input.icon,
    description: input.description?.trim() || null,
    points: input.points,
    shared_mode: assignees.length > 1 ? input.sharedMode : 'each',
    start_date: startDate,
    end_date: null,
    due_time: input.dueTime ?? null,
    recurrence: toRRule(recurrence),
    archived_at: null,
  };
}

const agendaQuery = z.object({
  from: z.string().refine(isLocalDate).optional(),
  to: z.string().refine(isLocalDate).optional(),
  member: z.string().optional(),
  overdue: z.enum(['0', '1']).optional(),
});

export const tasks = new Hono<AppBindings>()
  .get('/tasks', requireParent, async (c) => {
    const family = await loadFamily(c.env, c.get('auth').familyId);
    const today = todayOf(family);
    const rows = await all<TaskRow>(
      c.env.DB,
      `SELECT * FROM task WHERE family_id = ? AND archived_at IS NULL
         AND ((recurrence IS NOT NULL AND (end_date IS NULL OR end_date >= ?))
              OR (recurrence IS NULL AND start_date >= ?))
       ORDER BY title COLLATE NOCASE`,
      family.id,
      today,
      addDays(today, -14),
    );
    return c.json(await taskDtos(c.env, rows, today));
  })

  .get('/tasks/:id', requireParent, async (c) => {
    const family = await loadFamily(c.env, c.get('auth').familyId);
    const t = await loadTask(c.env, family.id, c.req.param('id'));
    return c.json((await taskDtos(c.env, [t], todayOf(family)))[0]);
  })

  .post('/tasks', requireParent, async (c) => {
    const input = await body(c, taskInput);
    const { familyId, memberId } = c.get('auth');
    const family = await loadFamily(c.env, familyId);
    const assignees = await validateAssignees(c.env, familyId, input.assignees);
    const id = newId();
    const t = rowFromInput(input, assignees, { id, family_id: familyId, series_id: id, created_by: memberId, created_at: Date.now() }, input.startDate);
    await writeTask(c.env, t, assignees, true);
    const today = todayOf(family);
    await generateForTask(c.env.DB, t, today);
    await background(c, notifyNewTask(c.env, family, assignees, t.title));
    return c.json((await taskDtos(c.env, [t], today))[0], 201);
  })

  .patch('/tasks/:id', requireParent, async (c) => {
    const input = await body(c, taskInput);
    const { familyId } = c.get('auth');
    const family = await loadFamily(c.env, familyId);
    const today = todayOf(family);
    const old = await loadTask(c.env, familyId, c.req.param('id'));
    if (old.end_date && old.end_date < today) throw conflict('task_ended');
    const assignees = await validateAssignees(c.env, familyId, input.assignees);
    const base = { id: old.id, family_id: familyId, series_id: old.series_id, created_by: old.created_by, created_at: old.created_at };

    if (old.recurrence === null) {
      // One-off: editable in place until someone has reported it.
      if (await hasCompletions(c.env.DB, old.id)) throw conflict('task_has_history');
      const t = rowFromInput(input, assignees, base, input.startDate);
      await dropUnreportedOccurrences(c.env.DB, old.id, null);
      await writeTask(c.env, t, assignees, false);
      await generateForTask(c.env.DB, t, today);
      return c.json((await taskDtos(c.env, [t], today))[0]);
    }

    const cutoff = (await hasCompletions(c.env.DB, old.id, today)) ? addDays(today, 1) : today;
    if (cutoff <= old.start_date) {
      // The series has not started yet: nothing to preserve.
      const t = rowFromInput(input, assignees, base, input.startDate > cutoff ? input.startDate : cutoff);
      await dropUnreportedOccurrences(c.env.DB, old.id, null);
      await writeTask(c.env, t, assignees, false);
      await generateForTask(c.env.DB, t, today);
      return c.json((await taskDtos(c.env, [t], today))[0]);
    }

    const rec = recurrenceOf(input);
    const sameRule = toRRule(rec) === old.recurrence;
    const start = input.startDate > cutoff ? input.startDate : sameRule ? alignWeeklyStart(old.start_date, rec, cutoff) : cutoff;
    await run(c.env.DB, 'UPDATE task SET end_date = ? WHERE id = ?', addDays(cutoff, -1), old.id);
    await dropUnreportedOccurrences(c.env.DB, old.id, cutoff);
    const next = rowFromInput(input, assignees, { ...base, id: newId(), created_at: Date.now() }, start);
    await writeTask(c.env, next, assignees, true);
    await generateForTask(c.env.DB, next, today);
    return c.json((await taskDtos(c.env, [next], today))[0]);
  })

  /** Deletes the whole series. Finished history stays; open and future days disappear. */
  .delete('/tasks/:id', requireParent, async (c) => {
    const { familyId } = c.get('auth');
    const t = await loadTask(c.env, familyId, c.req.param('id'));
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE occurrence SET cancelled_at = ?
          WHERE cancelled_at IS NULL AND task_id IN (SELECT id FROM task WHERE series_id = ? AND family_id = ?)
            AND NOT EXISTS (SELECT 1 FROM completion c WHERE c.occurrence_id = occurrence.id AND c.status IN ('approved', 'reported'))`,
      ).bind(now, t.series_id, familyId),
      c.env.DB.prepare('UPDATE task SET archived_at = ? WHERE series_id = ? AND family_id = ? AND archived_at IS NULL').bind(now, t.series_id, familyId),
    ]);
    return c.json({ ok: true });
  })

  /** Deletes a single day of a task. */
  .delete('/occurrences/:id', requireParent, async (c) => {
    const { familyId } = c.get('auth');
    const occ = await first<{ id: string }>(
      c.env.DB,
      'SELECT o.id FROM occurrence o JOIN task t ON t.id = o.task_id WHERE o.id = ? AND t.family_id = ? AND o.cancelled_at IS NULL',
      c.req.param('id'),
      familyId,
    );
    if (!occ) throw notFound('occurrence_not_found');
    const approved = await first(c.env.DB, "SELECT 1 FROM completion WHERE occurrence_id = ? AND status = 'approved'", occ.id);
    if (approved) throw conflict('already_done');
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE occurrence SET cancelled_at = ? WHERE id = ?').bind(now, occ.id),
      c.env.DB.prepare("UPDATE completion SET status = 'closed', reviewed_at = ? WHERE occurrence_id = ? AND status = 'reported'").bind(now, occ.id),
    ]);
    return c.json({ ok: true });
  })

  .get('/agenda', async (c) => {
    const q = query(c, agendaQuery);
    const { familyId, role, memberId } = c.get('auth');
    const family = await loadFamily(c.env, familyId);
    const now = Date.now();
    const today = todayOf(family, now);
    const from = q.from ?? today;
    const to = q.to ?? from;
    if (to < from || diffDays(to, from) > 62) throw badRequest('invalid_range');
    // Children only ever see their own tasks.
    const member = role === 'child' ? memberId : q.member;
    const items = await buildAgenda(c.env.DB, family, {
      from,
      to,
      today,
      now,
      memberId: member,
      includeOverdue: q.overdue === '1',
    });
    const dto: AgendaDto = { today, now, items };
    return c.json(dto);
  })

  .get('/week', requireParent, async (c) => {
    const q = query(c, z.object({ start: z.string().refine(isLocalDate).optional() }));
    const family = await loadFamily(c.env, c.get('auth').familyId);
    const now = Date.now();
    const today = todayOf(family, now);
    const start = startOfIsoWeek(q.start ?? today);
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const items = await buildAgenda(c.env.DB, family, { from: start, to: days[6]!, today, now });
    const children = await all<{ id: string }>(
      c.env.DB,
      "SELECT id FROM member WHERE family_id = ? AND role = 'child' AND removed_at IS NULL ORDER BY created_at",
      family.id,
    );
    const rows = children.map((child) => ({
      memberId: child.id,
      cells: days.map((date): WeekCellDto => {
        const cell: WeekCellDto = { date, done: 0, waiting: 0, overdue: 0, todo: 0, upcoming: 0 };
        for (const item of items) {
          if (item.date !== date) continue;
          const s = item.children.find((ch) => ch.memberId === child.id)?.state;
          if (!s) continue;
          if (s === 'approved' || s === 'closed') cell.done++;
          else if (s === 'reported') cell.waiting++;
          else if (s === 'overdue') cell.overdue++;
          else if (s === 'todo') cell.todo++;
          else cell.upcoming++;
        }
        return cell;
      }),
    }));
    const dto: WeekDto = { start, days, rows };
    return c.json(dto);
  });
