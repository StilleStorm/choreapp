import { describe, expect, it } from 'vitest';
import {
  DROP_WEIGHTS,
  type PoolItem,
  type Rarity,
  cryptoRng,
  pickDrop,
  pickRarity,
  pickStreakPack,
  seededRng,
  shouldDrop,
} from '../src/drops.js';

function pool(common: number, rare: number, legendary: number): PoolItem[] {
  const out: PoolItem[] = [];
  const add = (n: number, rarity: Rarity) => {
    for (let i = 0; i < n; i++) out.push({ id: `${rarity}-${i}`, rarity });
  };
  add(common, 'common');
  add(rare, 'rare');
  add(legendary, 'legendary');
  return out;
}

describe('drop chance', () => {
  it('first approval of the day always drops', () => {
    const rng = seededRng(1);
    for (let i = 0; i < 1000; i++) expect(shouldDrop(true, rng)).toBe(true);
  });

  it('later approvals drop about 1 in 4', () => {
    const rng = seededRng(42);
    let hits = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) if (shouldDrop(false, rng)) hits++;
    expect(hits / n).toBeGreaterThan(0.24);
    expect(hits / n).toBeLessThan(0.26);
  });
});

describe('rarity weights', () => {
  it('follow 75 / 20 / 5', () => {
    const rng = seededRng(7);
    const counts: Record<Rarity, number> = { common: 0, rare: 0, legendary: 0 };
    const all = new Set<Rarity>(['common', 'rare', 'legendary']);
    const n = 200_000;
    for (let i = 0; i < n; i++) counts[pickRarity(all, rng)!]++;
    for (const r of Object.keys(DROP_WEIGHTS) as Rarity[]) {
      expect(counts[r] / n).toBeCloseTo(DROP_WEIGHTS[r] / 100, 2);
    }
  });

  it('renormalise over rarities that still have stickers', () => {
    const rng = seededRng(3);
    const counts: Record<string, number> = { rare: 0, legendary: 0 };
    const n = 100_000;
    for (let i = 0; i < n; i++) counts[pickRarity(new Set<Rarity>(['rare', 'legendary']), rng)!]!++;
    expect(counts.rare! / n).toBeCloseTo(0.8, 2);
    expect(counts.legendary! / n).toBeCloseTo(0.2, 2);
  });

  it('returns null for an empty pool', () => {
    expect(pickRarity(new Set(), seededRng(1))).toBeNull();
    expect(pickDrop([], seededRng(1))).toBeNull();
  });
});

describe('no repeats', () => {
  it('drains the pool exactly once per sticker', () => {
    let remaining = pool(30, 8, 2);
    const seen = new Set<string>();
    const rng = seededRng(99);
    for (;;) {
      const item = pickDrop(remaining, rng);
      if (!item) break;
      expect(seen.has(item.id)).toBe(false);
      seen.add(item.id);
      remaining = remaining.filter((i) => i.id !== item.id);
    }
    expect(seen.size).toBe(40);
  });
});

describe('streak packs', () => {
  it('contain 3 distinct stickers with the guaranteed rarity', () => {
    for (let seed = 0; seed < 500; seed++) {
      const rng = seededRng(seed);
      const rare = pickStreakPack(pool(50, 10, 3), 'rare', rng);
      expect(rare.items).toHaveLength(3);
      expect(rare.missing).toBe(0);
      expect(new Set(rare.items.map((i) => i.id)).size).toBe(3);
      expect(rare.items.some((i) => i.rarity === 'rare')).toBe(true);

      const legendary = pickStreakPack(pool(50, 10, 3), 'legendary', rng);
      expect(legendary.items.some((i) => i.rarity === 'legendary')).toBe(true);
    }
  });

  it('fall back to the best available rarity', () => {
    const noRare = pickStreakPack(pool(10, 0, 1), 'rare', seededRng(1));
    expect(noRare.items[0]!.rarity).toBe('legendary');
    const noLegendary = pickStreakPack(pool(10, 2, 0), 'legendary', seededRng(1));
    expect(noLegendary.items[0]!.rarity).toBe('rare');
    const commonsOnly = pickStreakPack(pool(10, 0, 0), 'legendary', seededRng(1));
    expect(commonsOnly.items[0]!.rarity).toBe('common');
  });

  it('report unfilled slots when the pool runs out', () => {
    expect(pickStreakPack(pool(1, 0, 0), 'rare', seededRng(1))).toMatchObject({ missing: 2 });
    expect(pickStreakPack([], 'rare', seededRng(1))).toEqual({ items: [], missing: 3 });
  });
});

describe('crypto rng', () => {
  it('returns values in [0, 1)', () => {
    for (let i = 0; i < 1000; i++) {
      const x = cryptoRng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
