import { THEMES } from '@choreapp/shared';
import { describe, expect, it } from 'vitest';
import { ADULT_HIDDEN_THEMES, ADULT_THEMES, CHILD_THEMES, dataThemeFor } from './pickable.js';

describe('theme pickers', () => {
  it('children choose from the 25 themes, adults get the neutral style first and the readable themes', () => {
    expect(CHILD_THEMES.map((t) => t.id)).toEqual([...THEMES]);
    expect(ADULT_THEMES[0]!.id).toBe('neutral');
    expect(ADULT_THEMES.slice(1).map((t) => t.id)).toEqual(THEMES.filter((id) => !ADULT_HIDDEN_THEMES.includes(id)));
    expect(ADULT_THEMES).toHaveLength(1 + 25 - ADULT_HIDDEN_THEMES.length);
  });

  it('the neutral style uses the base tokens (no data-theme)', () => {
    expect(dataThemeFor('neutral')).toBeUndefined();
    expect(dataThemeFor(undefined)).toBeUndefined();
    expect(dataThemeFor('forest')).toBe('forest');
  });
});
