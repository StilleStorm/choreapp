/**
 * Calendar dates and wall-clock times in a family's time zone.
 *
 * A "LocalDate" is a plain `YYYY-MM-DD` string meaning a calendar day in the
 * family's zone. Day arithmetic happens on calendar dates only, never on
 * instants, so DST transitions cannot shift a task to a different day.
 * Instants are epoch milliseconds (UTC).
 */

export type LocalDate = string; // YYYY-MM-DD
export type LocalTime = string; // HH:MM (24h)

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

export function isLocalDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function isLocalTime(s: string): boolean {
  return TIME_RE.test(s);
}

export function parseDate(s: LocalDate): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(s);
  if (!match || !isLocalDate(s)) throw new Error(`Invalid date: ${s}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

export function formatDate(y: number, m: number, d: number): LocalDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseTime(s: LocalTime): { h: number; min: number } {
  const match = TIME_RE.exec(s);
  if (!match) throw new Error(`Invalid time: ${s}`);
  return { h: Number(match[1]), min: Number(match[2]) };
}

/** Minutes since local midnight. */
export function timeToMinutes(s: LocalTime): number {
  const { h, min } = parseTime(s);
  return h * 60 + min;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

/** Days since 1970-01-01 for a calendar date (proleptic Gregorian). */
export function toDayNumber(date: LocalDate): number {
  const { y, m, d } = parseDate(date);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(n: number): LocalDate {
  const dt = new Date(n * DAY_MS);
  return formatDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return fromDayNumber(toDayNumber(date) + days);
}

export function diffDays(a: LocalDate, b: LocalDate): number {
  return toDayNumber(a) - toDayNumber(b);
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(date: LocalDate): number {
  // 1970-01-01 was a Thursday (ISO 4).
  return ((((toDayNumber(date) + 3) % 7) + 7) % 7) + 1;
}

/** Monday of the ISO week containing `date`. */
export function startOfIsoWeek(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

/** Month arithmetic with the day clamped to the target month's length. */
export function addMonthsClamped(date: LocalDate, months: number, day?: number): LocalDate {
  const { y, m, d } = parseDate(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return formatDate(ny, nm, Math.min(day ?? d, daysInMonth(ny, nm)));
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minDate(a: LocalDate, b: LocalDate): LocalDate {
  return a <= b ? a : b;
}

export function maxDate(a: LocalDate, b: LocalDate): LocalDate {
  return a >= b ? a : b;
}

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  date: LocalDate;
  time: LocalTime;
  /** Minutes since local midnight. */
  minutes: number;
  second: number;
}

export function zonedParts(epochMs: number, tz: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(epochMs))) parts[p.type] = p.value;
  const h = Number(parts.hour) % 24;
  const min = Number(parts.minute);
  return {
    date: formatDate(Number(parts.year), Number(parts.month), Number(parts.day)),
    time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
    minutes: h * 60 + min,
    second: Number(parts.second),
  };
}

/** The calendar day in `tz` at the given instant. */
export function localDateAt(epochMs: number, tz: string): LocalDate {
  return zonedParts(epochMs, tz).date;
}

/** UTC offset of `tz` at an instant, in ms (Warsaw winter = +3_600_000). */
export function offsetAt(epochMs: number, tz: string): number {
  const p = zonedParts(epochMs, tz);
  const { y, m, d } = parseDate(p.date);
  const asUtc = Date.UTC(y, m - 1, d, Math.floor(p.minutes / 60), p.minutes % 60, p.second);
  return asUtc - Math.floor(epochMs / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `tz` shows `date time`.
 * Ambiguous times (autumn fall-back) resolve to the earlier instant; times
 * inside a spring-forward gap resolve forward (02:30 -> 03:30 in Warsaw),
 * matching Temporal's "compatible" disambiguation.
 */
export function zonedToEpoch(date: LocalDate, time: LocalTime, tz: string): number {
  const { y, m, d } = parseDate(date);
  const { h, min } = parseTime(time);
  const wall = Date.UTC(y, m - 1, d, h, min);
  const before = offsetAt(wall - DAY_MS, tz);
  const after = offsetAt(wall + DAY_MS, tz);
  const candidates: number[] = [];
  for (const off of before === after ? [before] : [before, after]) {
    const t = wall - off;
    const p = zonedParts(t, tz);
    if (p.date === date && p.time === time) candidates.push(t);
  }
  if (candidates.length > 0) return Math.min(...candidates);
  return wall - before;
}

/** Start of the given local day (local midnight, or the first instant after a gap). */
export function startOfLocalDay(date: LocalDate, tz: string): number {
  return zonedToEpoch(date, '00:00', tz);
}
