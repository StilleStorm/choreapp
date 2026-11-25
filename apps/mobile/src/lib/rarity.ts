import type { Rarity } from '@choreapp/core';

export const RARITY_LABEL: Record<Rarity, string> = { common: 'Zwykła', rare: 'Rzadka', legendary: 'Legendarna' };
export const KIND_LABEL = { sticker: 'Naklejka', avatar: 'Awatar', frame: 'Ramka' } as const;
