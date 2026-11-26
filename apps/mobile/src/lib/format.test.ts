import { describe, expect, it } from 'vitest';
import { capitalize, dayMonth, deviceStatus, devices, longDate, parentAccusative, plural, points, relativeDay } from './format.js';

describe('Polish formatting', () => {
  it('plural forms', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 112, 122].map((n) => points(n))).toEqual([
      '1 punkt', '2 punkty', '4 punkty', '5 punktów', '11 punktów', '12 punktów', '14 punktów',
      '21 punktów', '22 punkty', '25 punktów', '112 punktów', '122 punkty',
    ]);
    expect(plural(0, 'zadanie', 'zadania', 'zadań')).toBe('zadań');
  });

  it('device counts', () => {
    expect([0, 1, 2, 3, 4, 5, 11, 12, 13, 21, 22, 24, 25, 102].map(deviceStatus)).toEqual([
      'Bez telefonu', '1 urządzenie', '2 urządzenia', '3 urządzenia', '4 urządzenia', '5 urządzeń', '11 urządzeń',
      '12 urządzeń', '13 urządzeń', '21 urządzeń', '22 urządzenia', '24 urządzenia', '25 urządzeń', '102 urządzenia',
    ]);
    expect(devices(0)).toBe('0 urządzeń');
  });

  it('dates', () => {
    expect(dayMonth('2026-11-25')).toBe('25 listopada');
    expect(longDate('2026-11-25')).toBe('Środa, 25 listopada');
    expect(capitalize('środa')).toBe('Środa');
  });

  it('relative days', () => {
    expect(relativeDay('2026-11-25', '2026-11-25')).toBe('dziś');
    expect(relativeDay('2026-11-24', '2026-11-25')).toBe('wczoraj');
    expect(relativeDay('2026-11-26', '2026-11-25')).toBe('jutro');
    expect(relativeDay('2026-11-20', '2026-11-25')).toBe('5 dni temu');
    expect(relativeDay('2026-03-30', '2026-03-29')).toBe('jutro'); // across the DST switch
  });

  it('"czeka na mamę/tatę"', () => {
    expect(parentAccusative(['Mama', 'Tata'])).toBe('mamę/tatę');
    expect(parentAccusative(['Mama'])).toBe('mamę');
    expect(parentAccusative(['Tata'])).toBe('tatę');
    expect(parentAccusative(['Kasia', 'Marek'])).toBe('rodzica');
  });
});
