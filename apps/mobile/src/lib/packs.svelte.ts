/**
 * Sticker packs waiting to be opened by the child: new stickers from the
 * server (task drops, streak packs) and stickers just bought in the shop.
 * PackOpening.svelte (in the child layout) shows the first one in the queue.
 */
import type { ItemDto, NewItemDto } from '@choreapp/shared';
import { api } from './api.js';
import { groupPacks, type Pack } from './packGroups.js';

export { REASON_CAPTION } from './packGroups.js';
export type { Pack };

class PackQueue {
  queue = $state<Pack[]>([]);
  /** Server stickers shown but not yet marked as seen. */
  private unseen = false;
  private checking = false;
  /** "Seen" request in flight: a check must wait for it, or it gets the same stickers again. */
  private marking: Promise<void> | null = null;

  get current(): Pack | undefined {
    return this.queue[0];
  }

  /** Loads stickers the child has not opened yet. */
  async check(): Promise<void> {
    if (this.checking || this.queue.some((p) => p.fromServer)) return;
    this.checking = true;
    try {
      if (this.marking) await this.marking;
      const fresh = await api.get<NewItemDto[]>('/v1/collection/new');
      if (fresh.length === 0) return;
      this.unseen = true;
      this.queue = [...this.queue, ...groupPacks(fresh)];
    } catch {
      /* offline: try next time */
    } finally {
      this.checking = false;
    }
  }

  /** A sticker bought in the shop (already in the album; the pack is just for fun). */
  showPurchase(item: ItemDto): void {
    this.queue = [...this.queue, { key: `shop:${item.id}`, rarity: item.rarity, reason: 'shop', streakDays: null, items: [item], fromServer: false }];
  }

  /** The current pack is done (opened or skipped). */
  async next(): Promise<void> {
    this.queue = this.queue.slice(1);
    if (this.unseen && !this.queue.some((p) => p.fromServer)) {
      this.unseen = false;
      this.marking = api.post('/v1/collection/seen').then(
        () => {},
        () => {}, // shown again next time
      );
      await this.marking;
      this.marking = null;
    }
  }
}

export const packs = new PackQueue();
