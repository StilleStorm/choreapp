/**
 * Random sticker drops and streak packs.
 *  - First approved task of the day always drops a sticker, each further one
 *    with a 1 in 4 chance.
 *  - Rarity weights: common 75, rare 20, legendary 5.
 *  - No repeats: only stickers the child does not own yet are in the pool.
 *  - Empty pool: 5 points instead of the sticker.
 *  - Streak packs hold 3 stickers, one of them of the guaranteed rarity.
 */
import type { GuaranteedRarity } from './streak.js';

export type Rarity = 'common' | 'rare' | 'legendary';
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'legendary'];

export const DROP_WEIGHTS: Record<Rarity, number> = { common: 75, rare: 20, legendary: 5 };
export const EXTRA_DROP_CHANCE = 0.25;
export const EMPTY_POOL_POINTS = 5;
export const PACK_SIZE = 3;

/** Uniform random number in [0, 1). */
export type Rng = () => number;

export interface PoolItem {
  id: string;
  rarity: Rarity;
}

export function shouldDrop(isFirstApprovalToday: boolean, rng: Rng): boolean {
  return isFirstApprovalToday || rng() < EXTRA_DROP_CHANCE;
}

/** Picks a rarity by weight among those with items left; null when none. */
export function pickRarity(available: ReadonlySet<Rarity>, rng: Rng): Rarity | null {
  const options = RARITIES.filter((r) => available.has(r));
  if (options.length === 0) return null;
  const total = options.reduce((s, r) => s + DROP_WEIGHTS[r], 0);
  let x = rng() * total;
  for (const r of options) {
    x -= DROP_WEIGHTS[r];
    if (x < 0) return r;
  }
  return options[options.length - 1]!;
}

function pickFrom<T>(items: readonly T[], rng: Rng): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}

function rarities(pool: readonly PoolItem[]): Set<Rarity> {
  return new Set(pool.map((i) => i.rarity));
}

/** One sticker from the pool (items the child does not own), or null. */
export function pickDrop<T extends PoolItem>(pool: readonly T[], rng: Rng): T | null {
  const rarity = pickRarity(rarities(pool), rng);
  if (!rarity) return null;
  return pickFrom(
    pool.filter((i) => i.rarity === rarity),
    rng,
  );
}

const FALLBACK_ORDER: Record<GuaranteedRarity, Rarity[]> = {
  rare: ['rare', 'legendary', 'common'],
  legendary: ['legendary', 'rare', 'common'],
};

export interface PackResult<T> {
  items: T[];
  /** Slots that could not be filled (pool exhausted): 5 points each. */
  missing: number;
}

export function pickStreakPack<T extends PoolItem>(
  pool: readonly T[],
  guaranteed: GuaranteedRarity,
  rng: Rng,
): PackResult<T> {
  let remaining = [...pool];
  const items: T[] = [];
  const take = (item: T) => {
    items.push(item);
    remaining = remaining.filter((i) => i.id !== item.id);
  };

  for (const rarity of FALLBACK_ORDER[guaranteed]) {
    const candidates = remaining.filter((i) => i.rarity === rarity);
    if (candidates.length > 0) {
      take(pickFrom(candidates, rng));
      break;
    }
  }
  while (items.length < PACK_SIZE) {
    const next = pickDrop(remaining, rng);
    if (!next) break;
    take(next);
  }
  return { items, missing: PACK_SIZE - items.length };
}

/** Cryptographically strong Rng, available in Workers and browsers. */
export const cryptoRng: Rng = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
};

/** Deterministic Rng for tests (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
