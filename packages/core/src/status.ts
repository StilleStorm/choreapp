/**
 * Per-child state of a task occurrence. "To do" and "overdue" are never
 * stored: they follow from the absence of an active completion and the clock.
 */
import { type LocalDate, type LocalTime, addDays, localDateAt, startOfLocalDay, zonedToEpoch } from './date.js';

export type CompletionStatus = 'reported' | 'approved' | 'rejected' | 'closed';

export interface CompletionRecord {
  memberId: string;
  status: CompletionStatus;
  reportedAt: number;
  reviewedAt?: number | null;
  comment?: string | null;
}

export type ChildTaskState = 'upcoming' | 'todo' | 'overdue' | 'reported' | 'approved' | 'closed';

/**
 * The instant an occurrence becomes overdue: its due time that day, or the
 * end of the day when no time is set.
 */
export function dueInstant(date: LocalDate, dueTime: LocalTime | null, tz: string): number {
  return dueTime ? zonedToEpoch(date, dueTime, tz) : startOfLocalDay(addDays(date, 1), tz);
}

/** Most recent completion first (by report time; reviews never reorder). */
export function latestCompletion<T extends CompletionRecord>(completions: readonly T[]): T | null {
  let best: T | null = null;
  for (const c of completions) if (!best || c.reportedAt >= best.reportedAt) best = c;
  return best;
}

export interface ChildStateInput {
  date: LocalDate;
  dueTime: LocalTime | null;
  tz: string;
  now: number;
  /** This child's completions for the occurrence. */
  own: readonly CompletionRecord[];
  /** Shared "any" task already approved for a sibling. */
  closedBySibling: boolean;
}

export interface ChildState {
  state: ChildTaskState;
  /** Set when the latest attempt was rejected: the parent's note. */
  rejection: { comment: string | null; at: number } | null;
  canReport: boolean;
}

export function childState(input: ChildStateInput): ChildState {
  const latest = latestCompletion(input.own);
  if (latest?.status === 'approved') return { state: 'approved', rejection: null, canReport: false };
  if (latest?.status === 'reported') return { state: 'reported', rejection: null, canReport: false };
  if (latest?.status === 'closed' || input.closedBySibling)
    return { state: 'closed', rejection: null, canReport: false };

  const rejection =
    latest?.status === 'rejected'
      ? { comment: latest.comment ?? null, at: latest.reviewedAt ?? latest.reportedAt }
      : null;
  const today = localDateAt(input.now, input.tz);
  if (input.date > today) return { state: 'upcoming', rejection, canReport: false };
  const overdue = input.now >= dueInstant(input.date, input.dueTime, input.tz);
  return { state: overdue ? 'overdue' : 'todo', rejection, canReport: true };
}
