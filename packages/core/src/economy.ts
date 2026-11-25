import type { Rarity } from './drops.js';

export type PointSize = 'small' | 'medium' | 'large';

export const POINT_SIZES: Record<PointSize, number> = { small: 5, medium: 10, large: 20 };
export const DEFAULT_POINT_SIZE: PointSize = 'medium';

export const DEFAULT_PRICES: Record<Rarity, number> = { common: 30, rare: 80, legendary: 200 };

export function pointSizeOf(points: number): PointSize | null {
  for (const [size, value] of Object.entries(POINT_SIZES)) if (value === points) return size as PointSize;
  return null;
}

/** Ledger reasons. The balance is always the sum of a member's ledger. */
export type LedgerReason =
  | 'task' // task approved
  | 'drop_fallback' // drop rolled but sticker pool empty
  | 'streak_fallback' // streak pack slot could not be filled
  | 'shop' // digital item bought (negative)
  | 'reward' // parent reward chosen (negative)
  | 'reward_refund'; // parent cancelled a chosen reward

export function balanceOf(entries: readonly { amount: number }[]): number {
  return entries.reduce((s, e) => s + e.amount, 0);
}
