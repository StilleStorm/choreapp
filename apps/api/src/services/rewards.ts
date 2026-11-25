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
import type { DropResultDto } from '@choreapp/shared';
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
