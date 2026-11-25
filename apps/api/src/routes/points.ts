/** Points, streak and statistics per child. */
import { localDateAt, computeStreak } from '@choreapp/core';
import type { PointsDto, StatsDto } from '@choreapp/shared';
import { Hono } from 'hono';
import type { AppBindings, Env, AuthInfo } from '../env.js';
import { first } from '../lib/db.js';
import { ApiError, notFound } from '../lib/http.js';
import { loadFamily } from '../lib/rows.js';
import { stickerCounts } from '../services/catalog.js';
import { balances, historyEntries, ledger, loadHistory, onTimeRate, streakDto, streakOccurrences } from '../services/stats.js';

/** Parents see any child in the family; a child only themselves. */
async function resolveChild(env: Env, auth: AuthInfo, id: string): Promise<string> {
  const memberId = id === 'me' ? auth.memberId : id;
  if (auth.role === 'child' && memberId !== auth.memberId) throw new ApiError(403, 'forbidden');
  const m = await first(env.DB, "SELECT 1 FROM member WHERE id = ? AND family_id = ? AND role = 'child'", memberId, auth.familyId);
  if (!m) throw notFound('member_not_found');
  return memberId;
}

export const points = new Hono<AppBindings>()
  .get('/members/:id/points', async (c) => {
    const auth = c.get('auth');
    const memberId = await resolveChild(c.env, auth, c.req.param('id'));
    const family = await loadFamily(c.env, auth.familyId);
    const now = Date.now();
    const today = localDateAt(now, family.timezone);
    const [b, entries, history] = await Promise.all([
      balances(c.env.DB, memberId),
      ledger(c.env.DB, memberId),
      loadHistory(c.env.DB, family, memberId, today),
    ]);
    const dto: PointsDto = {
      balance: b.balance,
      earnedTotal: b.earned,
      streak: streakDto(computeStreak(streakOccurrences(history), { now })),
      ledger: entries,
    };
    return c.json(dto);
  })

  .get('/members/:id/stats', async (c) => {
    const auth = c.get('auth');
    const memberId = await resolveChild(c.env, auth, c.req.param('id'));
    const family = await loadFamily(c.env, auth.familyId);
    const now = Date.now();
    const today = localDateAt(now, family.timezone);
    const [b, history, stickers] = await Promise.all([
      balances(c.env.DB, memberId),
      loadHistory(c.env.DB, family, memberId, today),
      stickerCounts(c.env.DB, family.id, memberId),
    ]);
    const rate = onTimeRate(history, today);
    const dto: StatsDto = {
      memberId,
      balance: b.balance,
      earnedTotal: b.earned,
      spentTotal: b.spent,
      streak: streakDto(computeStreak(streakOccurrences(history), { now })),
      onTimeRate30: rate.rate,
      approvedCount30: rate.approved,
      stickersOwned: stickers.owned,
      stickersTotal: stickers.total,
      history: historyEntries(history, today, now),
    };
    return c.json(dto);
  });
