/** Polish date and number formatting. */
import { isoWeekday, parseDate, type LocalDate } from '@choreapp/core';

const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const WEEKDAYS = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];
const WEEKDAYS_SHORT = ['pon', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'];

export function weekdayName(date: LocalDate): string {
  return WEEKDAYS[isoWeekday(date) - 1]!;
}

export function weekdayShort(date: LocalDate): string {
  return WEEKDAYS_SHORT[isoWeekday(date) - 1]!;
}

/** "24 listopada" */
export function dayMonth(date: LocalDate): string {
  const { m, d } = parseDate(date);
  return `${d} ${MONTHS_GEN[m - 1]}`;
}

/** "Wtorek, 24 listopada" */
export function longDate(date: LocalDate): string {
  return capitalize(`${weekdayName(date)}, ${dayMonth(date)}`);
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Accusative for "czeka na …": mamę, tatę, mamę/tatę, or "rodzica". */
export function parentAccusative(names: string[]): string {
  const lower = names.map((n) => n.trim().toLowerCase());
  const mama = lower.some((n) => n === 'mama' || n === 'mamusia');
  const tata = lower.some((n) => n === 'tata' || n === 'tatuś');
  if (mama && tata) return 'mamę/tatę';
  if (mama && names.length === 1) return 'mamę';
  if (tata && names.length === 1) return 'tatę';
  return 'rodzica';
}

/** Relative day label used on task cards. */
export function relativeDay(date: LocalDate, today: LocalDate): string {
  const diff = Math.round((Date.UTC(...ymd(date)) - Date.UTC(...ymd(today))) / 86_400_000);
  if (diff === 0) return 'dziś';
  if (diff === 1) return 'jutro';
  if (diff === -1) return 'wczoraj';
  if (diff < -1) return `${-diff} ${plural(-diff, 'dzień', 'dni', 'dni')} temu`;
  return dayMonth(date);
}

function ymd(date: LocalDate): [number, number, number] {
  const { y, m, d } = parseDate(date);
  return [y, m - 1, d];
}

/** Polish plural: 1 punkt, 2 punkty, 5 punktów. */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return few;
  return many;
}

export function points(n: number): string {
  return `${n} ${plural(n, 'punkt', 'punkty', 'punktów')}`;
}

export function days(n: number): string {
  return `${n} ${plural(n, 'dzień', 'dni', 'dni')}`;
}

export function clockTime(epochMs: number, tz: string): string {
  return new Intl.DateTimeFormat('pl-PL', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(epochMs);
}

export function dateTime(epochMs: number, tz: string): string {
  return new Intl.DateTimeFormat('pl-PL', {
    timeZone: tz,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(epochMs);
}
