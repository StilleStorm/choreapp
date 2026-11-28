import type { NewItemDto } from '@choreapp/shared';
import { describe, expect, it } from 'vitest';
import { groupPacks, REASON_CAPTION } from './packGroups.js';

const item = (id: string, rarity: NewItemDto['rarity'], extra: Partial<NewItemDto>): NewItemDto => ({
  id,
  packId: 'p',
  kind: 'sticker',
  name: id,
  album: 'A',
  rarity,
  imageUrl: '',
  price: null,
  droppable: true,
  how: 'drop',
  reason: 'first_task',
  streakDays: null,
  bundle: `drop:${id}`,
  ...extra,
});

describe('groupPacks', () => {
  it('one pack per drop; the streak pack holds its 3 stickers in the guaranteed colour', () => {
    const s = { how: 'streak' as const, reason: 'streak' as const, streakDays: 30, bundle: 'streak:c1' };
    const packs = groupPacks([
      item('a', 'rare', {}),
      item('b', 'legendary', s),
      item('c', 'common', s),
      item('d', 'common', s),
      item('e', 'common', { reason: 'bonus_task' }),
    ]);
    expect(packs.map((p) => [p.reason, p.rarity, p.items.length])).toEqual([
      ['first_task', 'rare', 1],
      ['streak', 'legendary', 3],
      ['bonus_task', 'common', 1],
    ]);
    // Best sticker last.
    expect(packs[1]!.items.map((i) => i.id)).toEqual(['c', 'd', 'b']);
    expect(packs[1]!.items[0]).not.toHaveProperty('bundle');
  });

  it('7 and 14 day packs are gold (guaranteed rare) whatever is inside', () => {
    const s = { how: 'streak' as const, reason: 'streak' as const, streakDays: 7, bundle: 'streak:c2' };
    expect(groupPacks([item('a', 'common', s)])[0]!.rarity).toBe('rare');
  });

  it('captions say why the child got the pack', () => {
    expect(REASON_CAPTION.first_task(null)).toBe('Za pierwsze zadanie dnia!');
    expect(REASON_CAPTION.bonus_task(null)).toBe('Bonus za zadanie!');
    expect(REASON_CAPTION.streak(14)).toBe('Paczka za serię 14 dni!');
    expect(REASON_CAPTION.shop(null)).toBe('Kupione w sklepie');
  });
});
