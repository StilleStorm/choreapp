/** Reporting "Zrobiłem", the approvals queue, approve and reject. */
import { childState, dueInstant, type CompletionRecord } from '@choreapp/core';
import { parentCompleteBody, rejectBody, reportBody, type ApprovalDto, type ApproveResultDto, type ParentCompleteResultDto } from '@choreapp/shared';
import { Hono } from 'hono';
import type { AppBindings } from '../env.js';
import { requireChild, requireParent } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { all, first, isUniqueViolation, run } from '../lib/db.js';
import { ApiError, background, body, notFound } from '../lib/http.js';
import { loadFamily } from '../lib/rows.js';
import type { CompletionRow } from '../services/agenda.js';
import { approve, loadPendingCompletion } from '../services/approval.js';
import { notifyParentsOfReport, notifyReviewed } from '../services/notify.js';

/** How far back an offline-queued report may claim to have been made. */
const MAX_OFFLINE_MS = 48 * 3_600_000;

export const reviews = new Hono<AppBindings>()
  .post('/occurrences/:id/report', requireChild, async (c) => {
    const b = await body(c, reportBody);
    const { familyId, memberId } = c.get('auth');

    // Retried request from the offline queue: answer with the original result.
    const existing = await first<{ id: string; status: string }>(c.env.DB, 'SELECT id, status FROM completion WHERE client_op_id = ?', b.clientOpId);
    if (existing) return c.json({ completionId: existing.id, status: existing.status });

    const occ = await first<{ id: string; date: string; due_time: string | null; shared_mode: 'each' | 'any'; title: string }>(
      c.env.DB,
      `SELECT o.id, o.date, t.due_time, t.shared_mode, t.title FROM occurrence o JOIN task t ON t.id = o.task_id
        WHERE o.id = ? AND t.family_id = ? AND o.cancelled_at IS NULL AND t.archived_at IS NULL`,
      c.req.param('id'),
      familyId,
    );
    if (!occ) throw notFound('occurrence_not_found');
    const assigned = await first(
      c.env.DB,
      'SELECT 1 FROM task_assignee ta JOIN occurrence o ON o.task_id = ta.task_id WHERE o.id = ? AND ta.member_id = ?',
      occ.id,
      memberId,
    );
    if (!assigned) throw new ApiError(403, 'not_assigned');

    const family = await loadFamily(c.env, familyId);
    const now = Date.now();
    const reportedAt = b.reportedAt && b.reportedAt <= now && b.reportedAt >= now - MAX_OFFLINE_MS ? b.reportedAt : now;

    const rows = await all<CompletionRow>(c.env.DB, 'SELECT * FROM completion WHERE occurrence_id = ?', occ.id);
    const own: CompletionRecord[] = rows
      .filter((r) => r.member_id === memberId)
      .map((r) => ({ memberId: r.member_id, status: r.status, reportedAt: r.reported_at, reviewedAt: r.reviewed_at, comment: r.comment }));
    const closedBySibling = occ.shared_mode === 'any' && rows.some((r) => r.member_id !== memberId && r.status === 'approved');
    const state = childState({ date: occ.date, dueTime: occ.due_time, tz: family.timezone, now: reportedAt, own, closedBySibling });
    if (state.state === 'upcoming') throw new ApiError(409, 'future_task');
    if (state.state === 'reported') throw new ApiError(409, 'already_reported');
    if (state.state === 'approved' || state.state === 'closed') throw new ApiError(409, 'already_done');

    const id = newId();
    try {
      await run(
        c.env.DB,
        "INSERT INTO completion (id, occurrence_id, member_id, status, reported_at, client_op_id) VALUES (?, ?, ?, 'reported', ?, ?)",
        id,
        occ.id,
        memberId,
        reportedAt,
        b.clientOpId,
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await first<{ id: string; status: string }>(c.env.DB, 'SELECT id, status FROM completion WHERE client_op_id = ?', b.clientOpId);
        if (again) return c.json({ completionId: again.id, status: again.status });
      }
      throw e;
    }
    await background(c, notifyParentsOfReport(c.env, family, memberId, occ.title, id, now));
    return c.json({ completionId: id, status: 'reported' }, 201);
  })

  /**
   * "Zrobione" from the parent's occurrence sheet: the parent ticks the task off
   * for a child (with or without a phone). The completion is created and then
   * approved through the same path as a normal approve, so points, stickers,
   * streaks and the child's notification behave the same. A report already
   * waiting for review is simply approved.
   *
   * The parent vouches that the child did it, so a past day's task counts as
   * done on that day (on time): the completion's report time is capped at the
   * occurrence's due instant, and a late report waiting for review is moved
   * back the same way. Streaks don't break and history doesn't show it late.
   * Normal child reports and approvals keep the usual timing rules.
   */
  .post('/occurrences/:id/complete', requireParent, async (c) => {
    const b = await body(c, parentCompleteBody);
    const { familyId, memberId: parentId } = c.get('auth');

    const occ = await first<{ id: string; date: string; due_time: string | null; shared_mode: 'each' | 'any' }>(
      c.env.DB,
      `SELECT o.id, o.date, t.due_time, t.shared_mode FROM occurrence o JOIN task t ON t.id = o.task_id
        WHERE o.id = ? AND t.family_id = ? AND o.cancelled_at IS NULL AND t.archived_at IS NULL`,
      c.req.param('id'),
      familyId,
    );
    if (!occ) throw notFound('occurrence_not_found');

    // Retry or double tap with the same key: answer with the earlier result.
    const existing = await first<{ id: string; status: string; occurrence_id: string }>(
      c.env.DB,
      'SELECT id, status, occurrence_id FROM completion WHERE client_op_id = ?',
      b.clientOpId,
    );
    if (existing) {
      if (existing.occurrence_id !== occ.id || existing.status !== 'approved') throw new ApiError(409, 'already_done');
      const dto: ParentCompleteResultDto = { completionId: existing.id, status: 'approved', drop: null };
      return c.json(dto);
    }

    const assigned = await first(
      c.env.DB,
      `SELECT 1 FROM task_assignee ta JOIN occurrence o ON o.task_id = ta.task_id JOIN member m ON m.id = ta.member_id
        WHERE o.id = ? AND ta.member_id = ? AND m.role = 'child' AND m.removed_at IS NULL`,
      occ.id,
      b.memberId,
    );
    if (!assigned) throw new ApiError(403, 'not_assigned');

    const family = await loadFamily(c.env, familyId);
    const now = Date.now();
    const rows = await all<CompletionRow>(c.env.DB, 'SELECT * FROM completion WHERE occurrence_id = ?', occ.id);
    const own: CompletionRecord[] = rows
      .filter((r) => r.member_id === b.memberId)
      .map((r) => ({ memberId: r.member_id, status: r.status, reportedAt: r.reported_at, reviewedAt: r.reviewed_at, comment: r.comment }));
    const closedBySibling = occ.shared_mode === 'any' && rows.some((r) => r.member_id !== b.memberId && r.status === 'approved');
    const state = childState({ date: occ.date, dueTime: occ.due_time, tz: family.timezone, now, own, closedBySibling });
    if (state.state === 'upcoming') throw new ApiError(409, 'future_task');
    if (state.state === 'approved' || state.state === 'closed') throw new ApiError(409, 'already_done');

    // On time as vouched by the parent: never later than the occurrence's due instant.
    const vouchedAt = Math.min(now, dueInstant(occ.date, occ.due_time, family.timezone));
    let completionId: string;
    if (state.state === 'reported') {
      // The child already reported it: "Zrobione" approves that report.
      const waiting = rows.filter((r) => r.member_id === b.memberId && r.status === 'reported').sort((x, y) => y.reported_at - x.reported_at)[0]!;
      completionId = waiting.id;
      if (waiting.reported_at > vouchedAt) {
        await run(c.env.DB, "UPDATE completion SET reported_at = ? WHERE id = ? AND status = 'reported'", vouchedAt, completionId);
      }
    } else {
      completionId = newId();
      // One statement, so two parents tapping at once can't create two completions
      // (nor one for a sibling of an already finished "one of" task).
      const ins = await run(
        c.env.DB,
        `INSERT INTO completion (id, occurrence_id, member_id, status, reported_at, client_op_id)
         SELECT ?, ?, ?, 'reported', ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM completion WHERE occurrence_id = ?
               AND ((member_id = ? AND status IN ('reported', 'approved', 'closed')) OR (? = 'any' AND status = 'approved')))`,
        completionId,
        occ.id,
        b.memberId,
        vouchedAt,
        b.clientOpId,
        occ.id,
        b.memberId,
        occ.shared_mode,
      ).catch((e: unknown) => {
        if (isUniqueViolation(e)) throw new ApiError(409, 'already_done');
        throw e;
      });
      if (ins.meta.changes !== 1) throw new ApiError(409, 'already_done');
    }

    const pending = await loadPendingCompletion(c.env, familyId, completionId).catch((e: unknown) => {
      if (e instanceof ApiError && e.code === 'not_pending') throw new ApiError(409, 'already_done');
      throw e;
    });
    const drop = await approve(c.env, family, pending, parentId, new URL(c.req.url).origin, now).catch((e: unknown) => {
      if (e instanceof ApiError && e.code === 'not_pending') throw new ApiError(409, 'already_done');
      throw e;
    });
    await background(c, notifyReviewed(c.env, family, pending, true, null, drop));
    const dto: ParentCompleteResultDto = { completionId, status: 'approved', drop };
    return c.json(dto, 201);
  })

  .get('/approvals', requireParent, async (c) => {
    const family = await loadFamily(c.env, c.get('auth').familyId);
    const rows = await all<{
      id: string;
      occurrence_id: string;
      member_id: string;
      member_name: string;
      title: string;
      icon: string;
      points: number;
      date: string;
      due_time: string | null;
      reported_at: number;
    }>(
      c.env.DB,
      `SELECT c.id, c.occurrence_id, c.member_id, m.name AS member_name, t.title, t.icon, t.points, o.date, t.due_time, c.reported_at
         FROM completion c
         JOIN occurrence o ON o.id = c.occurrence_id
         JOIN task t ON t.id = o.task_id
         JOIN member m ON m.id = c.member_id
        WHERE t.family_id = ? AND c.status = 'reported' AND m.removed_at IS NULL AND o.cancelled_at IS NULL
        ORDER BY c.reported_at`,
      family.id,
    );
    const dto: ApprovalDto[] = rows.map((r) => ({
      completionId: r.id,
      occurrenceId: r.occurrence_id,
      memberId: r.member_id,
      memberName: r.member_name,
      title: r.title,
      icon: r.icon,
      points: r.points,
      date: r.date,
      reportedAt: r.reported_at,
      late: r.reported_at > dueInstant(r.date, r.due_time, family.timezone),
    }));
    return c.json(dto);
  })

  .post('/completions/:id/approve', requireParent, async (c) => {
    const { familyId, memberId } = c.get('auth');
    const family = await loadFamily(c.env, familyId);
    const pending = await loadPendingCompletion(c.env, familyId, c.req.param('id'));
    const drop = await approve(c.env, family, pending, memberId, new URL(c.req.url).origin);
    await background(c, notifyReviewed(c.env, family, pending, true, null, drop));
    const dto: ApproveResultDto = { completionId: pending.id, drop };
    return c.json(dto);
  })

  .post('/completions/:id/reject', requireParent, async (c) => {
    const b = await body(c, rejectBody);
    const { familyId, memberId } = c.get('auth');
    const family = await loadFamily(c.env, familyId);
    const pending = await loadPendingCompletion(c.env, familyId, c.req.param('id'));
    const comment = b.comment?.trim() || null;
    const res = await run(
      c.env.DB,
      "UPDATE completion SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, comment = ? WHERE id = ? AND status = 'reported'",
      Date.now(),
      memberId,
      comment,
      pending.id,
    );
    if (res.meta.changes !== 1) throw new ApiError(409, 'not_pending');
    await background(c, notifyReviewed(c.env, family, pending, false, comment, null));
    return c.json({ ok: true });
  });

