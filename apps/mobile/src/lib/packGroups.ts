import { guaranteedRarityFor, type Rarity } from '@choreapp/core';
import type { ItemDto, NewItemDto, RevealReason } from '@choreapp/shared';

/** One pack to open: a single sticker, or the 3 stickers of a streak pack. */
export interface Pack {
  key: string;
  /** Pack colour: the sticker's rarity, or the streak pack's guaranteed rarity. */
  rarity: Rarity;
  reason: RevealReason;
  streakDays: number | null;
  items: ItemDto[];
  /** From GET /v1/collection/new (marked seen once opened). */
  fromServer: boolean;
}

const ORDER: Rarity[] = ['common', 'rare', 'legendary'];

export function packRarity(reason: RevealReason, streakDays: number | null, rarities: readonly Rarity[]): Rarity {
  if (reason === 'streak' && streakDays) return guaranteedRarityFor(streakDays);
  return rarities.reduce<Rarity>((best, r) => (ORDER.indexOf(r) > ORDER.indexOf(best) ? r : best), 'common');
}

/** Groups new stickers into packs (by bundle), keeping the server's order. */
export function groupPacks(items: readonly NewItemDto[]): Pack[] {
  const packs = new Map<string, Pack>();
  for (const { how: _how, reason, streakDays, bundle, ...item } of items) {
    const pack = packs.get(bundle) ?? { key: bundle, rarity: 'common', reason, streakDays, items: [], fromServer: true };
    pack.items.push(item);
    packs.set(bundle, pack);
  }
  for (const p of packs.values()) {
    p.rarity = packRarity(p.reason, p.streakDays, p.items.map((i) => i.rarity));
    // The best sticker comes out last, as the big finish.
    p.items.sort((a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity));
  }
  return [...packs.values()];
}

/** Why the child got the pack, so they learn what earns stickers. */
export const REASON_CAPTION: Record<RevealReason, (days: number | null) => string> = {
  first_task: () => 'Za pierwsze zadanie dnia!',
  bonus_task: () => 'Bonus za zadanie!',
  streak: (days) => (days ? `Paczka za serię ${days} dni!` : 'Paczka za serię!'),
  shop: () => 'Kupione w sklepie',
};
