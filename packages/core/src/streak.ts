/**
 * "Seria bez wpadki": consecutive days on which a child did every task due
 * that day on time. Computed from completion report times, never stored.
 *
 * Rules (spec):
 *  - What counts is when the child reported, not when the parent approved.
 *  - Days without tasks neither extend nor break a streak.
 *  - A task that went overdue breaks it, even if done later (full points).
 *  - A rejected report counts only if re-reported before the deadline.
 *  - Shared "any one of you" tasks done on time by a sibling are neutral.
 *  - Days still in progress (something not yet due) neither count nor break.
 */
import type { LocalDate } from './date.js';
import type { CompletionRecord } from './status.js';

export interface StreakOccurrence {
  date: LocalDate;
  /** Instant the occurrence becomes overdue (see dueInstant). */
  due: number;
  sharedMode: 'each' | 'any';
  /** Cancelled occurrences are ignored. */
  cancelled?: boolean;
  /** This child's completions. */
  own: readonly CompletionRecord[];
  /** Siblings' completions (only relevant for "any" tasks). */
  others?: readonly CompletionRecord[];
}

export type DayResult = 'complete' | 'failed' | 'pending' | 'empty';

export interface StreakOptions {
  now: number;
  /**
   * Strict mode counts only approved completions. Used when awarding streak
   * packs, so a reward is never handed out for work that may still be rejected.
   * Display mode also counts reports still waiting for review.
   */
  strict?: boolean;
}

function onTime(c: CompletionRecord, due: number, strict: boolean): boolean {
  if (c.reportedAt > due) return false;
  return c.status === 'approved' || (!strict && c.status === 'reported');
}

/** Same as onTime but pending reports count as "might still succeed". */
function maybeOnTime(c: CompletionRecord, due: number): boolean {
  return c.reportedAt <= due && (c.status === 'approved' || c.status === 'reported');
}

type OccResult = 'ok' | 'failed' | 'pending' | 'neutral';

function occurrenceResult(o: StreakOccurrence, opts: StreakOptions): OccResult {
  if (o.cancelled) return 'neutral';
  const strict = opts.strict ?? false;
  if (o.own.some((c) => onTime(c, o.due, strict))) return 'ok';
  if (o.sharedMode === 'any' && (o.others ?? []).some((c) => onTime(c, o.due, strict))) return 'neutral';
  // In strict mode an on-time report awaiting review is undecided, not failed.
  if (strict) {
    if (o.own.some((c) => maybeOnTime(c, o.due))) return 'pending';
    if (o.sharedMode === 'any' && (o.others ?? []).some((c) => maybeOnTime(c, o.due))) return 'pending';
  }
  return opts.now >= o.due ? 'failed' : 'pending';
}

export function dayResults(occurrences: readonly StreakOccurrence[], opts: StreakOptions): Map<LocalDate, DayResult> {
  const byDay = new Map<LocalDate, OccResult[]>();
  for (const o of occurrences) {
    const list = byDay.get(o.date) ?? [];
    list.push(occurrenceResult(o, opts));
    byDay.set(o.date, list);
  }
  const out = new Map<LocalDate, DayResult>();
  for (const [date, results] of byDay) {
    const relevant = results.filter((r) => r !== 'neutral');
    let day: DayResult;
    if (relevant.length === 0) day = 'empty';
    else if (relevant.includes('failed')) day = 'failed';
    else if (relevant.includes('pending')) day = 'pending';
    else day = 'complete';
    out.set(date, day);
  }
  return out;
}

export interface StreakSummary {
  current: number;
  /** First day of the current streak, or null when it is 0. */
  currentStart: LocalDate | null;
  longest: number;
}

export function computeStreak(occurrences: readonly StreakOccurrence[], opts: StreakOptions): StreakSummary {
  const days = dayResults(occurrences, opts);
  const dates = [...days.keys()].sort();

  let current = 0;
  let currentStart: LocalDate | null = null;
  for (let i = dates.length - 1; i >= 0; i--) {
    const r = days.get(dates[i]!)!;
    if (r === 'failed') break;
    if (r === 'complete') {
      current++;
      currentStart = dates[i]!;
    }
  }

  let longest = 0;
  let run = 0;
  for (const d of dates) {
    const r = days.get(d)!;
    if (r === 'failed') run = 0;
    else if (r === 'complete') longest = Math.max(longest, ++run);
  }
  return { current, currentStart, longest: Math.max(longest, current) };
}

// ---------------------------------------------------------------------------
// Streak packs: 7 and 14 days (guaranteed rare), 30 and every further 30
// (guaranteed legendary).
// ---------------------------------------------------------------------------

export type GuaranteedRarity = 'rare' | 'legendary';

export function streakThresholdsUpTo(length: number): number[] {
  const out: number[] = [];
  if (length >= 7) out.push(7);
  if (length >= 14) out.push(14);
  for (let t = 30; t <= length; t += 30) out.push(t);
  return out;
}

export function guaranteedRarityFor(threshold: number): GuaranteedRarity {
  return threshold >= 30 ? 'legendary' : 'rare';
}

export interface AwardedThreshold {
  threshold: number;
  streakStart: LocalDate;
}

/**
 * Thresholds the current streak has reached that were not yet rewarded during
 * this streak. A streak's start can move earlier when an older pending day is
 * approved later, so an award counts for the streak if it was recorded with a
 * start date inside it.
 */
export function newStreakAwards(
  summary: StreakSummary,
  today: LocalDate,
  awarded: readonly AwardedThreshold[],
): number[] {
  if (!summary.currentStart || summary.current === 0) return [];
  const start = summary.currentStart;
  return streakThresholdsUpTo(summary.current).filter(
    (t) => !awarded.some((a) => a.threshold === t && a.streakStart >= start && a.streakStart <= today),
  );
}
