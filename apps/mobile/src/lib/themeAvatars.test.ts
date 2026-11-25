import type { ItemDto } from '@choreapp/shared';
import { describe, expect, it } from 'vitest';
import { groupThemeAvatars } from './themeAvatars.js';

const avatar = (id: string, theme?: string): ItemDto => ({
  id,
  packId: 'builtin-theme-avatars',
  kind: 'avatar',
  name: id,
  album: theme ?? 'Inne',
  rarity: 'common',
  imageUrl: `https://x/${id}.webp`,
  price: null,
  droppable: false,
  ...(theme ? { theme } : {}),
});

describe('groupThemeAvatars', () => {
  const items = [avatar('s1', 'space'), avatar('k1', 'kawaii'), avatar('s2', 'space'), avatar('m1', 'minimal'), avatar('x')];

  it('puts the own theme first and the rest in theme-list order', () => {
    const g = groupThemeAvatars(items, 'space');
    expect(g.own.map((i) => i.id)).toEqual(['s1', 's2']);
    expect(g.others.map((o) => [o.theme, o.title])).toEqual([
      ['kawaii', 'Pastelowe kawaii'],
      ['minimal', 'Minimal dla nastolatka'],
    ]);
  });

  it('has no own group for the neutral style', () => {
    const g = groupThemeAvatars(items, 'neutral');
    expect(g.own).toEqual([]);
    expect(g.others.map((o) => o.theme)).toEqual(['kawaii', 'space', 'minimal']);
  });
});
