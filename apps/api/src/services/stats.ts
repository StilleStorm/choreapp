/**
 * Points, streaks and statistics for one child. Everything is derived from
 * the ledger and from completions; nothing here is stored.
 */
import {
  addDays,
  computeStreak,
  dueInstant,
  guaranteedRarityFor,
  localDateAt,
  type CompletionRecord,
  type LocalDate,
  type StreakOccurrence,
  type StreakSummary,
} from '@choreapp/core';
import type { HistoryEntryDto, LedgerEntryDto, StreakDto } from '@choreapp/shared';
import { all, allIn, first } from '../lib/db.js';
import type { FamilyRow } from '../lib/rows.js';

interface MemberOccRow {
  occurrence_id: string;
  date: string;
  due_time: string | null;
  shared_mode: 'each' | 'any';
  cancelled_at: number | null;
  title: string;
  icon: string;
  points: number;
}

interface ComplRow {
  occurrence_id: string;
  member_id: string;
  status: CompletionRecord['status'];
  reported_at: number;
  reviewed_at: number | null;
}

export interface MemberHistory {
  occurrences: (MemberOccRow & { due: number; own: ComplRow[]; others: ComplRow[] })[];
}

/** The child's occurrences up to today (most recent `days` days), with completions. */
export async function loadHistory(db: D1Database, family: FamilyRow, memberId: string, today: LocalDate, days = 400): Promise<MemberHistory> {
  const occs = await all<MemberOccRow>(
    db,
    `SELECT o.id AS occurrence_id, o.date, t.due_time, t.shared_mode, o.cancelled_at, t.title, t.icon, t.points
       FROM occurrence o
       JOIN task t ON t.id = o.task_id
       JOIN task_assignee ta ON ta.task_id = t.id AND ta.member_id = ?
      WHERE t.family_id = ? AND o.date BETWEEN ? AND ?
      ORDER BY o.date`,
    memberId,
    family.id,
    addDays(today, -days),
    today,
  );
  const completions = await allIn<ComplRow>(
    db,
    (ph) => `SELECT occurrence_id, member_id, status, reported_at, reviewed_at FROM completion WHERE occurrence_id IN (${ph})`,
    occs.map((o) => o.occurrence_id),
  );
  const byOcc = new Map<string, ComplRow[]>();
  for (const c of completions) byOcc.set(c.occurrence_id, [...(byOcc.get(c.occurrence_id) ?? []), c]);
  return {
    occurrences: occs.map((o) => {
      const cs = byOcc.get(o.occurrence_id) ?? [];
      return {
        ...o,
        due: dueInstant(o.date, o.due_time, family.timezone),
        own: cs.filter((c) => c.member_id === memberId),
        others: cs.filter((c) => c.member_id !== memberId),
      };
    }),
  };
}

function toRecord(c: ComplRow): CompletionRecord {
  return { memberId: c.member_id, status: c.status, reportedAt: c.reported_at, reviewedAt: c.reviewed_at };
}

export function streakOccurrences(h: MemberHistory): StreakOccurrence[] {
  return h.occurrences.map((o) => ({
    date: o.date,
    due: o.due,
    sharedMode: o.shared_mode,
    cancelled: o.cancelled_at !== null,
    own: o.own.map(toRecord),
    others: o.others.map(toRecord),
  }));
}

export function nextPack(current: number): StreakDto['nextPack'] {
  const threshold = current < 7 ? 7 : current < 14 ? 14 : Math.floor(current / 30) * 30 + 30;
  return { threshold, daysLeft: threshold - current, rarity: guaranteedRarityFor(threshold) };
}

export function streakDto(s: StreakSummary): StreakDto {
  return { current: s.current, longest: s.longest, nextPack: nextPack(s.current) };
}

export async function memberStreak(db: D1Database, family: FamilyRow, memberId: string, now: number, strict = false): Promise<StreakSummary> {
  const today = localDateAt(now, family.timezone);
  return computeStreak(streakOccurrences(await loadHistory(db, family, memberId, today)), { now, strict });
}

export async function balances(db: D1Database, memberId: string): Promise<{ balance: number; earned: number; spent: number }> {
  const r = await first<{ balance: number; earned: number; spent: number }>(
    db,
    `SELECT COALESCE(SUM(amount), 0) AS balance,
            COALESCE(SUM(CASE WHEN reason IN ('task', 'drop_fallback', 'streak_fallback') THEN amount ELSE 0 END), 0) AS earned,
            COALESCE(-SUM(CASE WHEN reason IN ('shop', 'reward', 'reward_refund') THEN amount ELSE 0 END), 0) AS spent
       FROM points_ledger WHERE member_id = ?`,
    memberId,
  );
  return r ?? { balance: 0, earned: 0, spent: 0 };
}

export async function ledger(db: D1Database, memberId: string, limit = 50): Promise<LedgerEntryDto[]> {
  const rows = await all<{
    id: string;
    amount: number;
    reason: string;
    created_at: number;
    task_title: string | null;
    reward_name: string | null;
    item_name: string | null;
  }>(
    db,
    `SELECT l.id, l.amount, l.reason, l.created_at,
            t.title AS task_title, rw.name AS reward_name, i.name AS item_name
       FROM points_ledger l
       LEFT JOIN completion c ON c.id = l.completion_id
       LEFT JOIN occurrence o ON o.id = c.occurrence_id
       LEFT JOIN task t ON t.id = o.task_id
       LEFT JOIN redemption r ON r.id = l.redemption_id
       LEFT JOIN reward rw ON rw.id = r.reward_id
       LEFT JOIN member_item mi ON mi.id = l.member_item_id
       LEFT JOIN item i ON i.id = mi.item_id
      WHERE l.member_id = ?
      ORDER BY l.created_at DESC, l.rowid DESC
      LIMIT ?`,
    memberId,
    limit,
  );
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    reason: r.reason,
    createdAt: r.created_at,
    label:
      r.reason === 'task'
        ? (r.task_title ?? 'Zadanie')
        : r.reason === 'drop_fallback'
          ? 'Bonus: wszystkie naklejki zebrane'
          : r.reason === 'streak_fallback'
            ? 'Bonus za serię'
            : r.reason === 'shop'
              ? `Sklep: ${r.item_name ?? 'przedmiot'}`
              : r.reason === 'reward'
                ? `Nagroda: ${r.reward_name ?? ''}`
                : `Zwrot: ${r.reward_name ?? ''}`,
  }));
}

/** Last `days` days of tasks for the parent's history view, newest first. */
export function historyEntries(h: MemberHistory, today: LocalDate, now: number, days = 30): HistoryEntryDto[] {
  const from = addDays(today, -days);
  const out: HistoryEntryDto[] = [];
  for (const o of h.occurrences) {
    if (o.date < from || o.cancelled_at !== null) continue;
    const latest = [...o.own].sort((a, b) => b.reported_at - a.reported_at)[0];
    const siblingDone = o.shared_mode === 'any' && o.others.some((c) => c.status === 'approved');
    let status: HistoryEntryDto['status'];
    if (latest?.status === 'approved') status = 'approved';
    else if (latest?.status === 'reported') status = 'reported';
    else if (siblingDone || latest?.status === 'closed') status = 'closed';
    else if (latest?.status === 'rejected') status = 'rejected';
    else if (now >= o.due) status = 'missed';
    else continue; // still open today: not history yet
    out.push({
      date: o.date,
      title: o.title,
      icon: o.icon,
      status,
      points: status === 'approved' ? o.points : 0,
      late: !!latest && latest.reported_at > o.due,
      at: latest?.reported_at ?? null,
    });
  }
  return out.reverse();
}

/** Share of due tasks done on time over the last `days` full days. */
export function onTimeRate(h: MemberHistory, today: LocalDate, days = 30): { rate: number | null; approved: number } {
  const from = addDays(today, -days);
  let due = 0;
  let onTime = 0;
  let approved = 0;
  for (const o of h.occurrences) {
    if (o.date < from || o.date >= today || o.cancelled_at !== null) continue;
    if (o.own.some((c) => c.status === 'approved')) approved++;
    const mine = o.own.some((c) => c.status === 'approved' && c.reported_at <= o.due);
    const sibling = o.shared_mode === 'any' && o.others.some((c) => c.status === 'approved' && c.reported_at <= o.due);
    if (sibling && !mine) continue;
    due++;
    if (mine) onTime++;
  }
  return { rate: due === 0 ? null : onTime / due, approved };
}
