/**
 * What happens when a parent approves a report: the completion closes, the
 * points land in the ledger, a shared "any" task closes for the siblings,
 * and rewards (random sticker, streak pack) are evaluated.
 */
import type { DropResultDto } from '@choreapp/shared';
import type { Env } from '../env.js';
import { newId } from '../lib/crypto.js';
import { first } from '../lib/db.js';
import { ApiError } from '../lib/http.js';
import type { FamilyRow } from '../lib/rows.js';
import { rollRewards } from './rewards.js';

export interface PendingCompletion {
  id: string;
  occurrence_id: string;
  member_id: string;
  status: string;
  reported_at: number;
  points: number;
  shared_mode: 'each' | 'any';
  title: string;
  date: string;
  due_time: string | null;
}

export async function loadPendingCompletion(env: Env, familyId: string, completionId: string): Promise<PendingCompletion> {
  const c = await first<PendingCompletion>(
    env.DB,
    `SELECT c.id, c.occurrence_id, c.member_id, c.status, c.reported_at, t.points, t.shared_mode, t.title, o.date, t.due_time
       FROM completion c JOIN occurrence o ON o.id = c.occurrence_id JOIN task t ON t.id = o.task_id
      WHERE c.id = ? AND t.family_id = ?`,
    completionId,
    familyId,
  );
  if (!c) throw new ApiError(404, 'not_found');
  if (c.status !== 'reported') throw new ApiError(409, 'not_pending');
  return c;
}

export async function approve(
  env: Env,
  family: FamilyRow,
  completion: PendingCompletion,
  reviewerId: string,
  origin: string,
  now = Date.now(),
): Promise<DropResultDto> {
  // Claim the review atomically so two parents tapping at once can't double-pay.
  const claimed = await env.DB.prepare(
    "UPDATE completion SET status = 'approved', reviewed_at = ?, reviewed_by = ? WHERE id = ? AND status = 'reported'",
  )
    .bind(now, reviewerId, completion.id)
    .run();
  if (claimed.meta.changes !== 1) throw new ApiError(409, 'not_pending');

  const stmts = [
    env.DB.prepare(
      "INSERT INTO points_ledger (id, member_id, amount, reason, completion_id, created_at) VALUES (?, ?, ?, 'task', ?, ?)",
    ).bind(newId(), completion.member_id, completion.points, completion.id, now),
  ];
  if (completion.shared_mode === 'any') {
    stmts.push(
      env.DB.prepare(
        "UPDATE completion SET status = 'closed', reviewed_at = ?, reviewed_by = ? WHERE occurrence_id = ? AND member_id != ? AND status = 'reported'",
      ).bind(now, reviewerId, completion.occurrence_id, completion.member_id),
    );
  }
  await env.DB.batch(stmts);

  const rewards = await rollRewards(env, family, completion.member_id, completion.id, now, origin);
  return { points: completion.points, ...rewards };
}
