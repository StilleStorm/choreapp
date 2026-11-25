import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  diffDays,
  isLocalDate,
  isoWeekday,
  localDateAt,
  offsetAt,
  startOfIsoWeek,
  startOfLocalDay,
  zonedParts,
  zonedToEpoch,
} from '../src/date.js';

const WAW = 'Europe/Warsaw';
const H = 3_600_000;

describe('calendar arithmetic', () => {
  it('validates dates including leap days', () => {
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2026-13-01')).toBe(false);
    expect(isLocalDate('2026-1-01')).toBe(false);
  });

  it('adds days across months, years and DST dates', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(diffDays('2027-01-01', '2026-12-25')).toBe(7);
  });

  it('computes ISO weekdays and week starts', () => {
    expect(isoWeekday('2026-11-23')).toBe(1); // Monday
    expect(isoWeekday('2026-11-29')).toBe(7); // Sunday
    expect(startOfIsoWeek('2026-11-29')).toBe('2026-11-23');
    expect(startOfIsoWeek('2026-01-01')).toBe('2025-12-29');
  });

  it('clamps month arithmetic to the month length', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonthsClamped('2026-03-01', 0, 31)).toBe('2026-03-31');
    expect(addMonthsClamped('2026-04-01', 0, 31)).toBe('2026-04-30');
  });
});

describe('Europe/Warsaw time zone', () => {
  it('has +1h in winter and +2h in summer', () => {
    expect(offsetAt(Date.UTC(2026, 0, 15, 12), WAW)).toBe(1 * H);
    expect(offsetAt(Date.UTC(2026, 6, 15, 12), WAW)).toBe(2 * H);
  });

  it('maps instants to local dates near midnight', () => {
    // 23:30 UTC on Nov 24 is 00:30 on Nov 25 in Warsaw (CET).
    expect(localDateAt(Date.UTC(2026, 10, 24, 23, 30), WAW)).toBe('2026-11-25');
    // 22:30 UTC on Jul 1 is 00:30 on Jul 2 in Warsaw (CEST).
    expect(localDateAt(Date.UTC(2026, 6, 1, 22, 30), WAW)).toBe('2026-07-02');
    expect(zonedParts(Date.UTC(2026, 6, 1, 22, 30), WAW).time).toBe('00:30');
  });

  it('converts wall-clock times to instants in winter and summer', () => {
    expect(zonedToEpoch('2026-01-10', '15:00', WAW)).toBe(Date.UTC(2026, 0, 10, 14));
    expect(zonedToEpoch('2026-07-10', '15:00', WAW)).toBe(Date.UTC(2026, 6, 10, 13));
  });

  it('spring forward (2026-03-29): 02:00-03:00 does not exist', () => {
    expect(zonedToEpoch('2026-03-29', '01:59', WAW)).toBe(Date.UTC(2026, 2, 29, 0, 59));
    expect(zonedToEpoch('2026-03-29', '03:00', WAW)).toBe(Date.UTC(2026, 2, 29, 1, 0));
    // A time inside the gap moves forward by the gap length.
    const gap = zonedToEpoch('2026-03-29', '02:30', WAW);
    expect(gap).toBe(Date.UTC(2026, 2, 29, 1, 30));
    expect(zonedParts(gap, WAW).time).toBe('03:30');
    // The day is 23 hours long.
    expect(startOfLocalDay('2026-03-30', WAW) - startOfLocalDay('2026-03-29', WAW)).toBe(23 * H);
  });

  it('fall back (2026-10-25): 02:00-03:00 happens twice, earlier wins', () => {
    expect(zonedToEpoch('2026-10-25', '02:30', WAW)).toBe(Date.UTC(2026, 9, 25, 0, 30));
    expect(zonedToEpoch('2026-10-25', '03:30', WAW)).toBe(Date.UTC(2026, 9, 25, 2, 30));
    // The day is 25 hours long.
    expect(startOfLocalDay('2026-10-26', WAW) - startOfLocalDay('2026-10-25', WAW)).toBe(25 * H);
  });

  it('round-trips every quarter hour across both DST days', () => {
    for (const date of ['2026-03-29', '2026-10-25']) {
      let t = startOfLocalDay(date, WAW);
      const end = startOfLocalDay(addDays(date, 1), WAW);
      for (; t < end; t += 15 * 60_000) {
        const p = zonedParts(t, WAW);
        expect(p.date).toBe(date);
        const back = zonedToEpoch(p.date, p.time, WAW);
        // Ambiguous times map to the earlier instant; everything else is exact.
        expect(t - back === 0 || t - back === H).toBe(true);
      }
    }
  });
});
