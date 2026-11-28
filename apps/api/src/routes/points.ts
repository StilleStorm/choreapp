/** Points, streak and statistics per child. */
import { localDateAt, computeStreak } from '@choreapp/core';
import { bonusBody, type BonusResultDto, type PointsDto, type StatsDto } from '@choreapp/shared';
import { Hono } from 'hono';
import type { AppBindings, Env, AuthInfo } from '../env.js';
import { requireParent } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { first, isUniqueViolation, run } from '../lib/db.js';
import { ApiError, background, body, notFound } from '../lib/http.js';
import { loadFamily } from '../lib/rows.js';
import { stickerCounts } from '../services/catalog.js';
import { notifyBonus } from '../services/notify.js';
import { balances, historyEntries, ledger, ledgerEntry, loadHistory, onTimeRate, streakDto, streakOccurrences } from '../services/stats.js';

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

  /**
   * "Daj punkty": a parent adds bonus points with a short reason. Only adding;
   * points are never taken away here. Idempotent per clientOpId.
   */
  .post('/members/:id/bonus', requireParent, async (c) => {
    const b = await body(c, bonusBody);
    const auth = c.get('auth');
    const memberId = await resolveChild(c.env, auth, c.req.param('id'));
    const removed = await first(c.env.DB, 'SELECT 1 FROM member WHERE id = ? AND removed_at IS NOT NULL', memberId);
    if (removed) throw notFound('member_not_found');

    type Row = { id: string; member_id: string; amount: number; reason: string; created_at: number; note: string | null };
    const byKey = () => first<Row>(c.env.DB, 'SELECT id, member_id, amount, reason, created_at, note FROM points_ledger WHERE client_op_id = ?', b.clientOpId);
    const replay = async (row: Row) => {
      if (row.member_id !== memberId || row.reason !== 'bonus') throw new ApiError(409, 'conflict');
      const dto: BonusResultDto = { entry: ledgerEntry(row), balance: (await balances(c.env.DB, memberId)).balance };
      return c.json(dto);
    };
    const earlier = await byKey();
    if (earlier) return replay(earlier);

    const row: Row = { id: newId(), member_id: memberId, amount: b.amount, reason: 'bonus', created_at: Date.now(), note: b.reason };
    try {
      await run(
        c.env.DB,
        "INSERT INTO points_ledger (id, member_id, amount, reason, note, created_by, client_op_id, created_at) VALUES (?, ?, ?, 'bonus', ?, ?, ?, ?)",
        row.id,
        memberId,
        row.amount,
        row.note,
        auth.memberId,
        b.clientOpId,
        row.created_at,
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await byKey();
        if (again) return replay(again);
      }
      throw e;
    }
    const family = await loadFamily(c.env, auth.familyId);
    await background(c, notifyBonus(c.env, family, memberId, row.amount, b.reason, row.created_at));
    const dto: BonusResultDto = { entry: ledgerEntry(row), balance: (await balances(c.env.DB, memberId)).balance };
    return c.json(dto, 201);
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
