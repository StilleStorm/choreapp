import { describe, expect, it } from 'vitest';
import { zonedToEpoch } from '../src/date.js';
import { type CompletionRecord, childState, dueInstant } from '../src/status.js';

const WAW = 'Europe/Warsaw';
const at = (date: string, time: string) => zonedToEpoch(date, time, WAW);
const base = { tz: WAW, dueTime: null, own: [] as CompletionRecord[], closedBySibling: false };

describe('due instant', () => {
  it('is local midnight after the day without a time', () => {
    expect(dueInstant('2026-11-24', null, WAW)).toBe(Date.UTC(2026, 10, 24, 23));
  });
  it('is the due time when set, DST-aware', () => {
    expect(dueInstant('2026-07-01', '18:00', WAW)).toBe(Date.UTC(2026, 6, 1, 16));
    expect(dueInstant('2026-03-28', null, WAW)).toBe(Date.UTC(2026, 2, 28, 23)); // midnight before the switch
    expect(dueInstant('2026-03-29', null, WAW)).toBe(Date.UTC(2026, 2, 29, 22)); // 23h day
  });
});

describe('child task state', () => {
  it('future days are upcoming and cannot be reported', () => {
    const s = childState({ ...base, date: '2026-11-25', now: at('2026-11-24', '12:00') });
    expect(s).toMatchObject({ state: 'upcoming', canReport: false });
  });

  it('today is to do until its deadline, then overdue', () => {
    expect(childState({ ...base, date: '2026-11-24', now: at('2026-11-24', '23:59') }).state).toBe('todo');
    expect(childState({ ...base, date: '2026-11-24', now: at('2026-11-25', '00:00') }).state).toBe('overdue');
    const timed = { ...base, date: '2026-11-24', dueTime: '17:00' };
    expect(childState({ ...timed, now: at('2026-11-24', '16:59') }).state).toBe('todo');
    expect(childState({ ...timed, now: at('2026-11-24', '17:00') })).toMatchObject({
      state: 'overdue',
      canReport: true,
    });
  });

  it('overdue tasks stay reportable', () => {
    const s = childState({ ...base, date: '2026-11-01', now: at('2026-11-24', '10:00') });
    expect(s).toMatchObject({ state: 'overdue', canReport: true });
  });

  it('reported and approved states come from the latest completion', () => {
    const reported: CompletionRecord = { memberId: 'a', status: 'reported', reportedAt: at('2026-11-24', '10:00') };
    expect(childState({ ...base, date: '2026-11-24', now: at('2026-11-24', '11:00'), own: [reported] }).state).toBe(
      'reported',
    );
    const approved = { ...reported, status: 'approved' as const };
    expect(childState({ ...base, date: '2026-11-24', now: at('2026-11-26', '11:00'), own: [approved] }).state).toBe(
      'approved',
    );
  });

  it('a rejection sends the task back with the comment', () => {
    const rejected: CompletionRecord = {
      memberId: 'a',
      status: 'rejected',
      reportedAt: at('2026-11-24', '10:00'),
      reviewedAt: at('2026-11-24', '12:00'),
      comment: 'Pod łóżkiem dalej bałagan',
    };
    const s = childState({ ...base, date: '2026-11-24', now: at('2026-11-24', '13:00'), own: [rejected] });
    expect(s.state).toBe('todo');
    expect(s.canReport).toBe(true);
    expect(s.rejection?.comment).toBe('Pod łóżkiem dalej bałagan');

    const again: CompletionRecord = { memberId: 'a', status: 'reported', reportedAt: at('2026-11-24', '14:00') };
    expect(childState({ ...base, date: '2026-11-24', now: at('2026-11-24', '15:00'), own: [rejected, again] }).state).toBe(
      'reported',
    );
  });

  it('shared "any" tasks close for siblings', () => {
    const s = childState({ ...base, date: '2026-11-24', now: at('2026-11-24', '15:00'), closedBySibling: true });
    expect(s).toMatchObject({ state: 'closed', canReport: false });
  });
});
