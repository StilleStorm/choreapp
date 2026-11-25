import { describe, expect, it } from 'vitest';
import { zonedParts, zonedToEpoch } from '../src/date.js';
import { isQuietAt, isQuietMinute, quietEndsAt, reminderDue } from '../src/quiet.js';

const WAW = 'Europe/Warsaw';
const at = (date: string, time: string) => zonedToEpoch(date, time, WAW);

describe('quiet hours', () => {
  it('wrap around midnight by default (22:00-07:00)', () => {
    expect(isQuietMinute(21 * 60 + 59, '22:00', '07:00')).toBe(false);
    expect(isQuietMinute(22 * 60, '22:00', '07:00')).toBe(true);
    expect(isQuietMinute(3 * 60, '22:00', '07:00')).toBe(true);
    expect(isQuietMinute(6 * 60 + 59, '22:00', '07:00')).toBe(true);
    expect(isQuietMinute(7 * 60, '22:00', '07:00')).toBe(false);
  });

  it('support same-day windows and disabling', () => {
    expect(isQuietMinute(13 * 60, '12:00', '14:00')).toBe(true);
    expect(isQuietMinute(15 * 60, '12:00', '14:00')).toBe(false);
    expect(isQuietMinute(3 * 60, '00:00', '00:00')).toBe(false);
  });

  it('end the next morning when entered in the evening', () => {
    const end = quietEndsAt(at('2026-11-24', '22:30'), WAW, '22:00', '07:00');
    expect(end).toBe(at('2026-11-25', '07:00'));
  });

  it('end the same morning when entered after midnight', () => {
    expect(quietEndsAt(at('2026-11-25', '05:00'), WAW, '22:00', '07:00')).toBe(at('2026-11-25', '07:00'));
  });

  it('return now outside quiet hours', () => {
    const now = at('2026-11-24', '12:00');
    expect(quietEndsAt(now, WAW, '22:00', '07:00')).toBe(now);
  });

  it('end at 07:00 local on the spring DST night (one hour shorter)', () => {
    const start = at('2026-03-28', '22:00');
    const end = quietEndsAt(start, WAW, '22:00', '07:00');
    expect(zonedParts(end, WAW)).toMatchObject({ date: '2026-03-29', time: '07:00' });
    expect(end - start).toBe(8 * 3_600_000);
  });

  it('end at 07:00 local on the autumn DST night (one hour longer)', () => {
    const start = at('2026-10-24', '22:00');
    const end = quietEndsAt(start, WAW, '22:00', '07:00');
    expect(zonedParts(end, WAW)).toMatchObject({ date: '2026-10-25', time: '07:00' });
    expect(end - start).toBe(10 * 3_600_000);
  });

  it('treat the repeated 02:xx hour as quiet both times', () => {
    const first = Date.UTC(2026, 9, 25, 0, 30); // 02:30 CEST
    const second = Date.UTC(2026, 9, 25, 1, 30); // 02:30 CET
    expect(isQuietAt(first, WAW, '22:00', '07:00')).toBe(true);
    expect(isQuietAt(second, WAW, '22:00', '07:00')).toBe(true);
  });
});

describe('daily reminder', () => {
  it('fires once after the reminder time each local day', () => {
    expect(reminderDue(at('2026-11-24', '14:59'), WAW, '15:00', null)).toBe(false);
    expect(reminderDue(at('2026-11-24', '15:00'), WAW, '15:00', null)).toBe(true);
    expect(reminderDue(at('2026-11-24', '15:05'), WAW, '15:00', '2026-11-24')).toBe(false);
    expect(reminderDue(at('2026-11-25', '15:01'), WAW, '15:00', '2026-11-24')).toBe(true);
  });

  it('uses local time across DST (15:00 local is 13:00 UTC in summer)', () => {
    expect(reminderDue(Date.UTC(2026, 6, 1, 12, 59), WAW, '15:00', null)).toBe(false);
    expect(reminderDue(Date.UTC(2026, 6, 1, 13, 0), WAW, '15:00', null)).toBe(true);
    expect(reminderDue(Date.UTC(2026, 0, 1, 13, 59), WAW, '15:00', null)).toBe(false);
    expect(reminderDue(Date.UTC(2026, 0, 1, 14, 0), WAW, '15:00', null)).toBe(true);
  });
});
