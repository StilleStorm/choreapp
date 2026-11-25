/**
 * Quiet hours and the daily reminder. Quiet hours are a family-wide window of
 * local wall-clock time (default 22:00-07:00) in which no push is sent;
 * notifications that fall inside it are held and delivered as one digest
 * when the window ends.
 */
import { type LocalDate, type LocalTime, addDays, timeToMinutes, zonedParts, zonedToEpoch } from './date.js';

export const DEFAULT_QUIET_FROM = '22:00';
export const DEFAULT_QUIET_TO = '07:00';
export const DEFAULT_REMINDER_TIME = '15:00';
export const DEFAULT_TIME_ZONE = 'Europe/Warsaw';

/** Whether local minute-of-day `m` falls in [from, to). Equal bounds = no quiet hours. */
export function isQuietMinute(m: number, from: LocalTime, to: LocalTime): boolean {
  const f = timeToMinutes(from);
  const t = timeToMinutes(to);
  if (f === t) return false;
  return f < t ? m >= f && m < t : m >= f || m < t;
}

export function isQuietAt(now: number, tz: string, from: LocalTime, to: LocalTime): boolean {
  return isQuietMinute(zonedParts(now, tz).minutes, from, to);
}

/** When the quiet window containing `now` ends; `now` itself if not quiet. */
export function quietEndsAt(now: number, tz: string, from: LocalTime, to: LocalTime): number {
  const p = zonedParts(now, tz);
  if (!isQuietMinute(p.minutes, from, to)) return now;
  const f = timeToMinutes(from);
  const t = timeToMinutes(to);
  // In a window that wraps midnight, the evening part ends tomorrow morning.
  const endDate: LocalDate = f > t && p.minutes >= f ? addDays(p.date, 1) : p.date;
  return zonedToEpoch(endDate, to, tz);
}

/**
 * Whether the daily reminder should go out now: the local reminder time has
 * passed today and it was not sent today yet. If the reminder time itself is
 * inside quiet hours, the reminder is queued like any other notification.
 */
export function reminderDue(now: number, tz: string, reminderTime: LocalTime, lastSentDate: LocalDate | null): boolean {
  const p = zonedParts(now, tz);
  return p.minutes >= timeToMinutes(reminderTime) && lastSentDate !== p.date;
}
