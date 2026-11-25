import { describe, expect, it } from 'vitest';
import {
  type Recurrence,
  describeRecurrence,
  expandOccurrences,
  nextOccurrence,
  parseRRule,
  toRRule,
} from '../src/recurrence.js';

const s = (recurrence: Recurrence, startDate: string, endDate: string | null = null) => ({
  recurrence,
  startDate,
  endDate,
});

describe('RRULE serialisation', () => {
  const cases: [Recurrence, string | null][] = [
    [{ kind: 'once' }, null],
    [{ kind: 'daily' }, 'FREQ=DAILY'],
    [{ kind: 'weekly', interval: 1, days: [5, 1, 3] }, 'FREQ=WEEKLY;BYDAY=MO,WE,FR'],
    [{ kind: 'weekly', interval: 2, days: [6] }, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA'],
    [{ kind: 'monthly', day: 15 }, 'FREQ=MONTHLY;BYMONTHDAY=15'],
    [{ kind: 'monthly', day: 28 }, 'FREQ=MONTHLY;BYMONTHDAY=28'],
    [{ kind: 'monthly', day: 30 }, 'FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1'],
    [{ kind: 'monthly', day: 31 }, 'FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1'],
  ];

  it.each(cases)('%j <-> %s', (rec, rrule) => {
    expect(toRRule(rec)).toBe(rrule);
    const parsed = parseRRule(rrule);
    if (rec.kind === 'weekly' && parsed.kind === 'weekly') {
      expect(parsed.days).toEqual([...rec.days].sort());
      expect(parsed.interval).toBe(rec.interval);
    } else {
      expect(parsed).toEqual(rec);
    }
  });

  it('accepts an RRULE: prefix and lower case', () => {
    expect(parseRRule('RRULE:freq=daily')).toEqual({ kind: 'daily' });
  });

  it('rejects rules outside the supported subset', () => {
    expect(() => parseRRule('FREQ=YEARLY')).toThrow();
    expect(() => parseRRule('FREQ=DAILY;COUNT=3')).toThrow();
    expect(() => parseRRule('FREQ=WEEKLY')).toThrow();
    expect(() => parseRRule('FREQ=WEEKLY;BYDAY=XX')).toThrow();
    expect(() => parseRRule('FREQ=MONTHLY;BYMONTHDAY=1,2')).toThrow();
    expect(() => parseRRule('FREQ=MONTHLY;BYMONTHDAY=32')).toThrow();
    expect(() => toRRule({ kind: 'weekly', interval: 1, days: [] })).toThrow();
    expect(() => toRRule({ kind: 'weekly', interval: 0, days: [1] })).toThrow();
  });
});

describe('expanding occurrences', () => {
  it('one-off task occurs only on its date', () => {
    const sched = s({ kind: 'once' }, '2026-11-26');
    expect(expandOccurrences(sched, '2026-11-20', '2026-11-30')).toEqual(['2026-11-26']);
    expect(expandOccurrences(sched, '2026-11-27', '2026-11-30')).toEqual([]);
  });

  it('daily task covers every day including both DST days', () => {
    const sched = s({ kind: 'daily' }, '2026-03-27');
    expect(expandOccurrences(sched, '2026-03-26', '2026-03-31')).toEqual([
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
    ]);
    const autumn = expandOccurrences(s({ kind: 'daily' }, '2026-10-01'), '2026-10-24', '2026-10-26');
    expect(autumn).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });

  it('chosen weekdays', () => {
    const sched = s({ kind: 'weekly', interval: 1, days: [1, 3, 5] }, '2026-11-24'); // Tue
    expect(expandOccurrences(sched, '2026-11-23', '2026-12-06')).toEqual([
      '2026-11-25',
      '2026-11-27',
      '2026-11-30',
      '2026-12-02',
      '2026-12-04',
    ]);
  });

  it('every 2 weeks is anchored to the start week', () => {
    // Starts on Wed 2026-11-25; Saturdays every other week from that week.
    const sched = s({ kind: 'weekly', interval: 2, days: [6] }, '2026-11-25');
    expect(expandOccurrences(sched, '2026-11-01', '2027-01-10')).toEqual([
      '2026-11-28',
      '2026-12-12',
      '2026-12-26',
      '2027-01-09',
    ]);
  });

  it('every 3 weeks on Monday across the year boundary', () => {
    const sched = s({ kind: 'weekly', interval: 3, days: [1] }, '2026-12-14');
    expect(expandOccurrences(sched, '2026-12-01', '2027-02-01')).toEqual(['2026-12-14', '2027-01-04', '2027-01-25']);
  });

  it('monthly on day 31 falls on the last day of shorter months', () => {
    const sched = s({ kind: 'monthly', day: 31 }, '2027-12-31');
    expect(expandOccurrences(sched, '2027-12-01', '2028-06-30')).toEqual([
      '2027-12-31',
      '2028-01-31',
      '2028-02-29', // leap year
      '2028-03-31',
      '2028-04-30',
      '2028-05-31',
      '2028-06-30',
    ]);
    expect(expandOccurrences(s({ kind: 'monthly', day: 31 }, '2026-01-31'), '2026-02-01', '2026-02-28')).toEqual([
      '2026-02-28',
    ]);
  });

  it('monthly on day 30 in February', () => {
    const sched = s({ kind: 'monthly', day: 30 }, '2026-01-30');
    expect(expandOccurrences(sched, '2026-01-01', '2026-03-31')).toEqual(['2026-01-30', '2026-02-28', '2026-03-30']);
  });

  it('monthly never yields dates before the start date', () => {
    const sched = s({ kind: 'monthly', day: 5 }, '2026-11-24');
    expect(expandOccurrences(sched, '2026-11-01', '2027-01-31')).toEqual(['2026-12-05', '2027-01-05']);
  });

  it('respects the series end date (edit splits the series)', () => {
    const before = s({ kind: 'daily' }, '2026-11-20', '2026-11-23');
    const after = s({ kind: 'weekly', interval: 1, days: [6, 7] }, '2026-11-24');
    const all = [
      ...expandOccurrences(before, '2026-11-20', '2026-11-30'),
      ...expandOccurrences(after, '2026-11-20', '2026-11-30'),
    ];
    expect(all).toEqual(['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-28', '2026-11-29']);
  });

  it('finds the next occurrence', () => {
    expect(nextOccurrence(s({ kind: 'monthly', day: 31 }, '2026-01-31'), '2026-04-01')).toBe('2026-04-30');
    expect(nextOccurrence(s({ kind: 'once' }, '2026-01-01'), '2026-04-01')).toBeNull();
  });

  it('describes rules in Polish', () => {
    expect(describeRecurrence({ kind: 'weekly', interval: 2, days: [6] })).toBe('Co 2 tyg.: sob');
    expect(describeRecurrence({ kind: 'monthly', day: 31 })).toContain('ostatni dzień');
  });
});
