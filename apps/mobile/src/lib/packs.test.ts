import { describe, expect, it, vi } from 'vitest';

const item = (id: string) => ({
  id,
  packId: 'p',
  kind: 'sticker',
  name: id,
  album: 'A',
  rarity: 'common',
  imageUrl: '',
  price: null,
  droppable: true,
  how: 'drop',
  reason: 'first_task',
  streakDays: null,
  bundle: `drop:${id}`,
});

let unseen = [item('s1')];
let releaseSeen: () => void = () => {};
const get = vi.fn(async () => [...unseen]);
const post = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      releaseSeen = () => {
        unseen = [];
        resolve();
      };
    }),
);
vi.mock('./api.js', () => ({ api: { get, post } }));

const { packs } = await import('./packs.svelte.js');

describe('pack queue', () => {
  it('a check while "seen" is being saved does not bring the opened pack back', async () => {
    await packs.check();
    expect(packs.queue).toHaveLength(1);
    const done = packs.next(); // the child finished the pack; "seen" is in flight
    const check = packs.check(); // e.g. the layout re-checks at that moment
    releaseSeen();
    await done;
    await check;
    expect(post).toHaveBeenCalledTimes(1);
    expect(packs.queue).toHaveLength(0);
  });
});
