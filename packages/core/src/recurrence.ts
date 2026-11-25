/**
 * Task recurrence. The database stores an RFC 5545 RRULE string (or null for
 * one-off tasks); concrete occurrences are expanded from it per calendar day.
 *
 * Only the subset the app can produce is supported:
 *   daily                FREQ=DAILY
 *   chosen weekdays      FREQ=WEEKLY;BYDAY=MO,WE,FR
 *   every N weeks        FREQ=WEEKLY;INTERVAL=2;BYDAY=SA
 *   monthly on day D     FREQ=MONTHLY;BYMONTHDAY=15
 *   monthly on day > 28  FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1
 * The last form is the standard RRULE idiom for "day 31, or the last day of a
 * shorter month", which is what the spec asks for.
 */
import {
  type LocalDate,
  addDays,
  addMonthsClamped,
  diffDays,
  formatDate,
  isoWeekday,
  maxDate,
  minDate,
  parseDate,
  startOfIsoWeek,
} from './date.js';

/** ISO weekday 1 (Mon) .. 7 (Sun). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Recurrence =
  | { kind: 'once' }
  | { kind: 'daily' }
  | { kind: 'weekly'; interval: number; days: Weekday[] }
  | { kind: 'monthly'; day: number };

const BYDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

export const MAX_WEEK_INTERVAL = 12;

export function validateRecurrence(r: Recurrence): string | null {
  switch (r.kind) {
    case 'once':
    case 'daily':
      return null;
    case 'weekly': {
      if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > MAX_WEEK_INTERVAL)
        return 'invalid_interval';
      if (r.days.length === 0) return 'no_days';
      if (r.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return 'invalid_day';
      return null;
    }
    case 'monthly':
      return Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 ? null : 'invalid_day';
  }
}

function sortedDays(days: Weekday[]): Weekday[] {
  return [...new Set(days)].sort((a, b) => a - b);
}

export function toRRule(r: Recurrence): string | null {
  const err = validateRecurrence(r);
  if (err) throw new Error(`Invalid recurrence: ${err}`);
  switch (r.kind) {
    case 'once':
      return null;
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekly': {
      const byday = sortedDays(r.days).map((d) => BYDAY_CODES[d - 1]).join(',');
      return r.interval === 1
        ? `FREQ=WEEKLY;BYDAY=${byday}`
        : `FREQ=WEEKLY;INTERVAL=${r.interval};BYDAY=${byday}`;
    }
    case 'monthly': {
      if (r.day <= 28) return `FREQ=MONTHLY;BYMONTHDAY=${r.day}`;
      const days: number[] = [];
      for (let d = 28; d <= r.day; d++) days.push(d);
      return `FREQ=MONTHLY;BYMONTHDAY=${days.join(',')};BYSETPOS=-1`;
    }
  }
}

export function parseRRule(rrule: string | null): Recurrence {
  if (rrule === null || rrule === '') return { kind: 'once' };
  const parts = new Map<string, string>();
  for (const seg of rrule.replace(/^RRULE:/i, '').split(';')) {
    const [k, v] = seg.split('=');
    if (!k || v === undefined) throw new Error(`Malformed RRULE: ${rrule}`);
    parts.set(k.toUpperCase(), v.toUpperCase());
  }
  const freq = parts.get('FREQ');
  const known = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYSETPOS', 'WKST']);
  for (const k of parts.keys()) if (!known.has(k)) throw new Error(`Unsupported RRULE part: ${k}`);
  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1;

  let result: Recurrence;
  if (freq === 'DAILY') {
    if (interval !== 1 || parts.has('BYDAY') || parts.has('BYMONTHDAY'))
      throw new Error(`Unsupported daily RRULE: ${rrule}`);
    result = { kind: 'daily' };
  } else if (freq === 'WEEKLY') {
    const byday = parts.get('BYDAY');
    if (!byday) throw new Error(`Weekly RRULE without BYDAY: ${rrule}`);
    const days = byday.split(',').map((code) => {
      const i = BYDAY_CODES.indexOf(code as (typeof BYDAY_CODES)[number]);
      if (i < 0) throw new Error(`Unsupported BYDAY: ${code}`);
      return (i + 1) as Weekday;
    });
    result = { kind: 'weekly', interval, days: sortedDays(days) };
  } else if (freq === 'MONTHLY') {
    const bmd = parts.get('BYMONTHDAY');
    if (!bmd || interval !== 1) throw new Error(`Unsupported monthly RRULE: ${rrule}`);
    const days = bmd.split(',').map(Number);
    if (days.length === 1 && !parts.has('BYSETPOS')) {
      result = { kind: 'monthly', day: days[0]! };
    } else if (parts.get('BYSETPOS') === '-1' && days[0] === 28) {
      days.forEach((d, i) => {
        if (d !== 28 + i) throw new Error(`Unsupported monthly RRULE: ${rrule}`);
      });
      result = { kind: 'monthly', day: days[days.length - 1]! };
    } else {
      throw new Error(`Unsupported monthly RRULE: ${rrule}`);
    }
  } else {
    throw new Error(`Unsupported FREQ: ${freq}`);
  }
  const err = validateRecurrence(result);
  if (err) throw new Error(`Invalid RRULE (${err}): ${rrule}`);
  return result;
}

export interface Schedule {
  recurrence: Recurrence;
  /** First day the task applies. For one-off tasks, the due day. */
  startDate: LocalDate;
  /** Last day (inclusive) the series applies, or null if open-ended. */
  endDate: LocalDate | null;
}

/** Calendar days in [from, to] (inclusive) on which the task occurs. */
export function expandOccurrences(s: Schedule, from: LocalDate, to: LocalDate): LocalDate[] {
  const lo = maxDate(from, s.startDate);
  const hi = s.endDate ? minDate(to, s.endDate) : to;
  if (lo > hi) return [];
  const r = s.recurrence;
  const out: LocalDate[] = [];

  switch (r.kind) {
    case 'once':
      if (s.startDate >= lo && s.startDate <= hi) out.push(s.startDate);
      break;
    case 'daily':
      for (let d = lo; d <= hi; d = addDays(d, 1)) out.push(d);
      break;
    case 'weekly': {
      const anchor = startOfIsoWeek(s.startDate);
      const days = new Set<number>(r.days);
      for (let d = lo; d <= hi; d = addDays(d, 1)) {
        if (!days.has(isoWeekday(d))) continue;
        const weeks = diffDays(startOfIsoWeek(d), anchor) / 7;
        if (weeks % r.interval === 0) out.push(d);
      }
      break;
    }
    case 'monthly': {
      const { y, m } = parseDate(lo);
      let month = formatDate(y, m, 1);
      for (;;) {
        const d = addMonthsClamped(month, 0, r.day);
        if (d > hi) break;
        if (d >= lo) out.push(d);
        month = addMonthsClamped(month, 1, 1);
      }
      break;
    }
  }
  return out;
}

/** The first occurrence on or after `from`, searching up to `horizonDays` ahead. */
export function nextOccurrence(s: Schedule, from: LocalDate, horizonDays = 400): LocalDate | null {
  return expandOccurrences(s, from, addDays(from, horizonDays))[0] ?? null;
}

/** Polish summary of a recurrence, for the parent's task list. */
export function describeRecurrence(r: Recurrence): string {
  const names = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'niedz'];
  switch (r.kind) {
    case 'once':
      return 'Jednorazowo';
    case 'daily':
      return 'Codziennie';
    case 'weekly': {
      const days = sortedDays(r.days).map((d) => names[d - 1]).join(', ');
      if (r.interval === 1) return r.days.length === 7 ? 'Codziennie' : `Co tydzień: ${days}`;
      return `Co ${r.interval} tyg.: ${days}`;
    }
    case 'monthly':
      return r.day >= 29 ? `Co miesiąc, ${r.day}. (lub ostatni dzień)` : `Co miesiąc, ${r.day}.`;
  }
}
