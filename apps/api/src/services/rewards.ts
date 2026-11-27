/**
 * Rewards evaluated when a parent approves a task:
 *  1. Random sticker: the first approval of the day always drops one, every
 *     further approval with a 1 in 4 chance; 75/20/5 by rarity; no repeats;
 *     5 points instead when the child already has every sticker.
 *  2. Streak packs: reaching 7 or 14 days gives 3 stickers with a guaranteed
 *     rare, 30 and every further 30 days a guaranteed legendary. Counted in
 *     strict mode (approved work only) and at most once per streak.
 */
import {
  EMPTY_POOL_POINTS,
  cryptoRng,
  guaranteedRarityFor,
  localDateAt,
  newStreakAwards,
  pickDrop,
  pickStreakPack,
  shouldDrop,
  startOfLocalDay,
  type Rng,
} from '@choreapp/core';
import type { DropResultDto, NewItemDto } from '@choreapp/shared';
import type { Env } from '../env.js';
import { newId } from '../lib/crypto.js';
import { all, first } from '../lib/db.js';
import { itemDto, type FamilyRow, type ItemRow } from '../lib/rows.js';
import { dropPool } from './catalog.js';
import { memberStreak } from './stats.js';

/** Overridable in tests for deterministic draws. */
export const rewardRng: { rng: Rng } = { rng: cryptoRng };

export async function rollRewards(
  env: Env,
  family: FamilyRow,
  memberId: string,
  completionId: string,
  now: number,
  origin: string,
): Promise<Omit<DropResultDto, 'points'>> {
  const rng = rewardRng.rng;
  const today = localDateAt(now, family.timezone);
  const won: ItemRow[] = [];
  let fallbackPoints = 0;
  let streakPack: DropResultDto['streakPack'] = null;
  const stmts: D1PreparedStatement[] = [];

  const grant = (item: ItemRow, how: 'drop' | 'streak') => {
    won.push(item);
    stmts.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO member_item (id, member_id, item_id, acquired_at, how, completion_id) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(newId(), memberId, item.id, now, how, completionId),
    );
  };
  const bonus = (amount: number, reason: 'drop_fallback' | 'streak_fallback') => {
    fallbackPoints += amount;
    stmts.push(
      env.DB.prepare('INSERT INTO points_ledger (id, member_id, amount, reason, completion_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
        newId(),
        memberId,
        amount,
        reason,
        completionId,
        now,
      ),
    );
  };

  // 1. Random sticker
  const earlier = await first<{ n: number }>(
    env.DB,
    "SELECT COUNT(*) AS n FROM completion WHERE member_id = ? AND status = 'approved' AND reviewed_at >= ? AND id != ?",
    memberId,
    startOfLocalDay(today, family.timezone),
    completionId,
  );
  let pool = await dropPool(env.DB, family.id, memberId);
  if (shouldDrop((earlier?.n ?? 0) === 0, rng)) {
    const item = pickDrop(pool, rng);
    if (item) {
      grant(item, 'drop');
      pool = pool.filter((i) => i.id !== item.id);
    } else {
      bonus(EMPTY_POOL_POINTS, 'drop_fallback');
    }
  }

  // 2. Streak packs
  const summary = await memberStreak(env.DB, family, memberId, now, true);
  const awarded = await all<{ threshold: number; streak_start: string }>(
    env.DB,
    'SELECT threshold, streak_start FROM streak_award WHERE member_id = ?',
    memberId,
  );
  const thresholds = newStreakAwards(
    summary,
    today,
    awarded.map((a) => ({ threshold: a.threshold, streakStart: a.streak_start })),
  );
  for (const threshold of thresholds) {
    const pack = pickStreakPack(pool, guaranteedRarityFor(threshold), rng);
    for (const item of pack.items) {
      grant(item, 'streak');
      pool = pool.filter((i) => i.id !== item.id);
    }
    if (pack.missing > 0) bonus(pack.missing * EMPTY_POOL_POINTS, 'streak_fallback');
    stmts.push(
      env.DB.prepare('INSERT INTO streak_award (id, member_id, threshold, streak_start, completion_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
        newId(),
        memberId,
        threshold,
        summary.currentStart!,
        completionId,
        now,
      ),
    );
    streakPack = { threshold };
  }

  if (stmts.length > 0) await env.DB.batch(stmts);
  return {
    items: await Promise.all(won.map((i) => itemDto(env, origin, i, family))),
    fallbackPoints,
    streakPack,
  };
}

export interface NewItemRow {
  how: 'drop' | 'streak' | 'shop';
  completion_id: string | null;
  member_item_id: string;
}

/**
 * Why each unseen sticker was given, derived from existing data so the pack
 * can tell the child what earned it: a drop from the first approved task of
 * that day (always drops) or a later one (bonus), a streak pack (its length
 * from streak_award), or a purchase.
 */
export async function revealReasons(
  env: Env,
  family: FamilyRow,
  memberId: string,
  rows: readonly NewItemRow[],
): Promise<Pick<NewItemDto, 'reason' | 'streakDays' | 'bundle'>[]> {
  const ids = [...new Set(rows.map((r) => r.completion_id).filter((id): id is string => id !== null))];
  const firstOfDay = new Map<string, boolean>();
  const streakDays = new Map<string, number>();
  for (const id of ids) {
    const done = await first<{ reviewed_at: number | null; threshold: number | null }>(
      env.DB,
      `SELECT c.reviewed_at, (SELECT MAX(threshold) FROM streak_award sa WHERE sa.completion_id = c.id) AS threshold
         FROM completion c WHERE c.id = ? AND c.member_id = ?`,
      id,
      memberId,
    );
    if (done?.threshold) streakDays.set(id, done.threshold);
    if (rows.some((r) => r.completion_id === id && r.how === 'drop') && done?.reviewed_at) {
      const dayStart = startOfLocalDay(localDateAt(done.reviewed_at, family.timezone), family.timezone);
      const earlier = await first<{ n: number }>(
        env.DB,
        `SELECT COUNT(*) AS n FROM completion WHERE member_id = ?1 AND status = 'approved' AND id != ?4 AND reviewed_at >= ?2
           AND (reviewed_at < ?3 OR (reviewed_at = ?3 AND rowid < (SELECT rowid FROM completion WHERE id = ?4)))`,
        memberId,
        dayStart,
        done.reviewed_at,
        id,
      );
      firstOfDay.set(id, (earlier?.n ?? 0) === 0);
    }
  }
  return rows.map((r) => {
    const key = r.completion_id ?? r.member_item_id;
    if (r.how === 'streak') return { reason: 'streak', streakDays: (r.completion_id && streakDays.get(r.completion_id)) || null, bundle: `streak:${key}` };
    if (r.how === 'shop') return { reason: 'shop', streakDays: null, bundle: `shop:${r.member_item_id}` };
    const isFirst = r.completion_id ? firstOfDay.get(r.completion_id) : undefined;
    return { reason: isFirst === false ? 'bonus_task' : 'first_task', streakDays: null, bundle: `drop:${r.member_item_id}` };
  });
}
