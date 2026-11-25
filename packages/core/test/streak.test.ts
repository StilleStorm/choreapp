import { describe, expect, it } from 'vitest';
import { addDays, zonedToEpoch } from '../src/date.js';
import { type CompletionRecord, dueInstant } from '../src/status.js';
import {
  type StreakOccurrence,
  computeStreak,
  guaranteedRarityFor,
  newStreakAwards,
  streakThresholdsUpTo,
} from '../src/streak.js';

const WAW = 'Europe/Warsaw';
const at = (date: string, time: string) => zonedToEpoch(date, time, WAW);

function occ(
  date: string,
  own: CompletionRecord[] = [],
  extra: Partial<StreakOccurrence> & { dueTime?: string } = {},
): StreakOccurrence {
  return { date, due: dueInstant(date, extra.dueTime ?? null, WAW), sharedMode: 'each', own, ...extra };
}
const done = (date: string, time = '18:00', status: CompletionRecord['status'] = 'approved'): CompletionRecord => ({
  memberId: 'kid',
  status,
  reportedAt: at(date, time),
});
/** n consecutive days ending at `last`, each with one task done on time. */
function perfectDays(last: string, n: number): StreakOccurrence[] {
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(last, i - n + 1);
    return occ(d, [done(d)]);
  });
}

describe('streak counting', () => {
  it('counts consecutive complete days', () => {
    const r = computeStreak(perfectDays('2026-11-23', 5), { now: at('2026-11-24', '09:00') });
    expect(r).toEqual({ current: 5, currentStart: '2026-11-19', longest: 5 });
  });

  it('uses the report date, not the approval date', () => {
    // Reported 21:30 on the due day, approved next morning: still on time.
    const c: CompletionRecord = { ...done('2026-11-23', '21:30'), reviewedAt: at('2026-11-24', '08:00') };
    const r = computeStreak([occ('2026-11-23', [c])], { now: at('2026-11-24', '09:00') });
    expect(r.current).toBe(1);
  });

  it('days without tasks do not break the streak', () => {
    const occs = [occ('2026-11-20', [done('2026-11-20')]), occ('2026-11-23', [done('2026-11-23')])];
    expect(computeStreak(occs, { now: at('2026-11-24', '09:00') }).current).toBe(2);
  });

  it('a task that went overdue breaks the streak even if done later', () => {
    const occs = [
      ...perfectDays('2026-11-20', 3),
      occ('2026-11-21', [done('2026-11-22', '10:00')]), // done a day late
      ...perfectDays('2026-11-23', 2),
    ];
    const r = computeStreak(occs, { now: at('2026-11-24', '09:00') });
    expect(r.current).toBe(2);
    expect(r.longest).toBe(3);
  });

  it('all tasks of a day must be done', () => {
    const occs = [occ('2026-11-23', [done('2026-11-23')]), occ('2026-11-23', [])];
    expect(computeStreak(occs, { now: at('2026-11-24', '09:00') }).current).toBe(0);
  });

  it('due time is the deadline when set', () => {
    const late = occ('2026-11-23', [done('2026-11-23', '17:30')], { dueTime: '17:00' });
    const onTime = occ('2026-11-22', [done('2026-11-22', '16:59')], { dueTime: '17:00' });
    expect(computeStreak([onTime], { now: at('2026-11-24', '09:00') }).current).toBe(1);
    expect(computeStreak([onTime, late], { now: at('2026-11-24', '09:00') }).current).toBe(0);
  });

  it('rejected and corrected in time keeps the streak, uncorrected breaks it', () => {
    const rejected: CompletionRecord = { ...done('2026-11-23', '15:00'), status: 'rejected' };
    const fixed = done('2026-11-23', '19:00');
    expect(computeStreak([occ('2026-11-23', [rejected, fixed])], { now: at('2026-11-24', '09:00') }).current).toBe(1);
    expect(computeStreak([occ('2026-11-23', [rejected])], { now: at('2026-11-24', '09:00') }).current).toBe(0);
    const fixedLate = done('2026-11-24', '08:00');
    expect(
      computeStreak([...perfectDays('2026-11-22', 2), occ('2026-11-23', [rejected, fixedLate])], {
        now: at('2026-11-24', '09:00'),
      }).current,
    ).toBe(0);
  });

  it('today in progress neither counts nor breaks', () => {
    const occs = [...perfectDays('2026-11-23', 3), occ('2026-11-24')];
    expect(computeStreak(occs, { now: at('2026-11-24', '12:00') }).current).toBe(3);
    // Once today is done it counts.
    const doneToday = [...perfectDays('2026-11-23', 3), occ('2026-11-24', [done('2026-11-24', '11:00')])];
    expect(computeStreak(doneToday, { now: at('2026-11-24', '12:00') }).current).toBe(4);
  });

  it('pending reports count for display but not in strict mode', () => {
    const pending = done('2026-11-23', '18:00', 'reported');
    const occs = [...perfectDays('2026-11-22', 3), occ('2026-11-23', [pending])];
    const now = at('2026-11-24', '09:00');
    expect(computeStreak(occs, { now }).current).toBe(4);
    const strict = computeStreak(occs, { now, strict: true });
    expect(strict.current).toBe(3); // pending day skipped, not broken
  });

  it('a pending report submitted late fails even in display mode', () => {
    const lateReport = done('2026-11-24', '08:00', 'reported');
    expect(computeStreak([occ('2026-11-23', [lateReport])], { now: at('2026-11-24', '09:00') }).current).toBe(0);
  });

  it('cancelled occurrences are ignored', () => {
    const occs = [...perfectDays('2026-11-23', 2), occ('2026-11-23', [], { cancelled: true })];
    expect(computeStreak(occs, { now: at('2026-11-24', '09:00') }).current).toBe(2);
  });

  it('shared "any" task done on time by a sibling is neutral', () => {
    const sibling: CompletionRecord = { memberId: 'sis', status: 'approved', reportedAt: at('2026-11-23', '12:00') };
    const anyTask = occ('2026-11-23', [], { sharedMode: 'any', others: [sibling] });
    const occs = [...perfectDays('2026-11-22', 2), anyTask];
    expect(computeStreak(occs, { now: at('2026-11-24', '09:00') }).current).toBe(2);
    // ...but if nobody did it in time, it breaks for everyone assigned.
    const lateSibling = { ...sibling, reportedAt: at('2026-11-24', '08:00') };
    const missed = occ('2026-11-23', [], { sharedMode: 'any', others: [lateSibling] });
    expect(computeStreak([...perfectDays('2026-11-22', 2), missed], { now: at('2026-11-24', '09:00') }).current).toBe(
      0,
    );
  });

  it('keeps day boundaries right across the spring DST switch', () => {
    // Report at 23:30 local on the 23-hour day is still on time.
    const occs = [occ('2026-03-28', [done('2026-03-28', '23:30')]), occ('2026-03-29', [done('2026-03-29', '23:30')])];
    expect(computeStreak(occs, { now: at('2026-03-30', '09:00') }).current).toBe(2);
    // 00:30 on the 30th is late for the 29th.
    const late = [occ('2026-03-29', [done('2026-03-30', '00:30')])];
    expect(computeStreak(late, { now: at('2026-03-30', '09:00') }).current).toBe(0);
  });

  it('keeps day boundaries right across the autumn DST switch', () => {
    // The 25-hour day: a report at 23:59 local is on time.
    const occs = [occ('2026-10-25', [done('2026-10-25', '23:59')])];
    expect(computeStreak(occs, { now: at('2026-10-26', '09:00') }).current).toBe(1);
  });
});

describe('streak packs', () => {
  it('thresholds are 7, 14, then every 30', () => {
    expect(streakThresholdsUpTo(6)).toEqual([]);
    expect(streakThresholdsUpTo(29)).toEqual([7, 14]);
    expect(streakThresholdsUpTo(95)).toEqual([7, 14, 30, 60, 90]);
    expect(guaranteedRarityFor(7)).toBe('rare');
    expect(guaranteedRarityFor(14)).toBe('rare');
    expect(guaranteedRarityFor(30)).toBe('legendary');
    expect(guaranteedRarityFor(60)).toBe('legendary');
  });

  it('awards each threshold once per streak', () => {
    const summary = { current: 15, currentStart: '2026-11-10', longest: 15 };
    expect(newStreakAwards(summary, '2026-11-24', [])).toEqual([7, 14]);
    expect(newStreakAwards(summary, '2026-11-24', [{ threshold: 7, streakStart: '2026-11-10' }])).toEqual([14]);
  });

  it('a new streak after a break can earn the thresholds again', () => {
    const summary = { current: 7, currentStart: '2026-11-18', longest: 20 };
    const old = [
      { threshold: 7, streakStart: '2026-10-01' },
      { threshold: 14, streakStart: '2026-10-01' },
    ];
    expect(newStreakAwards(summary, '2026-11-24', old)).toEqual([7]);
  });

  it('does not double award when the streak start moves earlier', () => {
    // Awarded 7 when the streak looked like it started on the 12th; a pending
    // day on the 11th was approved later, so the streak now starts on the 11th.
    const summary = { current: 8, currentStart: '2026-11-11', longest: 8 };
    expect(newStreakAwards(summary, '2026-11-18', [{ threshold: 7, streakStart: '2026-11-12' }])).toEqual([]);
  });
});
