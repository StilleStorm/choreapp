import { afterAll, describe, expect, it } from 'vitest';
import { addChild, call, env, registerFamily } from './helpers.js';

const DELUXE = 'builtin-frames-deluxe';

/** Runs the seed's statements for one pack (the whole seed would flood the shared test DB). */
async function seedPack(packId: string) {
  const lines = env.TEST_BUILTIN_SEED.split('\n').filter((l) => l.startsWith('INSERT') && l.includes(`'${packId}'`));
  await env.DB.batch(lines.map((l) => env.DB.prepare(l)));
  return lines.length;
}

// Hide the pack again for the other test files (they share the DB; bought items keep their rows).
afterAll(async () => {
  await env.DB.batch([
    env.DB.prepare('UPDATE item SET deleted_at = ? WHERE pack_id = ?').bind(Date.now(), DELUXE),
    env.DB.prepare('UPDATE pack SET active = 0 WHERE id = ?').bind(DELUXE),
  ]);
});

describe('built-in seed: Ramki Deluxe', () => {
  it('adds the pack and 12 frames (4 per rarity), idempotently', async () => {
    expect(await seedPack(DELUXE)).toBe(13);
    await seedPack(DELUXE); // the seed is re-run on every deploy
    const pack = await env.DB.prepare('SELECT * FROM pack WHERE id = ?').bind(DELUXE).first<any>();
    expect(pack).toMatchObject({ name: 'Ramki Deluxe', family_id: null, license: 'private', attribution: '© Stille Storm Studio', active: 1 });
    expect(pack.source).toMatch(/gpt-image/);
    const { results } = await env.DB.prepare('SELECT * FROM item WHERE pack_id = ? ORDER BY sort').bind(DELUXE).all<any>();
    expect(results).toHaveLength(12);
    for (const i of results) {
      expect(i.id).toMatch(/^frame-v2_[a-z_]+$/);
      expect(i.kind).toBe('frame');
      expect(i.image_key).toMatch(/^builtin\/frames-v2\/[a-z_]+\.webp$/);
      // Like the first frames: never dropped, sold at the family's price for the rarity.
      expect(i.price).toBe(0);
      expect(i.droppable).toBe(0);
    }
    const count = (r: string) => results.filter((i) => i.rarity === r).length;
    expect([count('common'), count('rare'), count('legendary')]).toEqual([4, 4, 4]);
  });

  it('is in every family shop at the default rarity prices and can be worn after buying', async () => {
    await seedPack(DELUXE);
    const fam = await registerFamily();
    const ola = await addChild(fam, 'Ola');
    const shop = await call('GET', '/v1/shop', { token: ola.token });
    const deluxe = shop.body.items.filter((i: any) => i.packId === DELUXE);
    expect(deluxe).toHaveLength(12);
    const prices = Object.fromEntries(deluxe.map((i: any) => [i.rarity, i.price]));
    expect(prices).toEqual({ common: 30, rare: 80, legendary: 200 });
    for (const i of deluxe) expect(i.imageUrl).toMatch(/\/builtin\/frames-v2\/[a-z_]+\.webp$/);

    await env.DB.prepare("INSERT INTO points_ledger (id, member_id, amount, reason, created_at) VALUES (?, ?, 200, 'task', ?)")
      .bind(crypto.randomUUID(), ola.id, Date.now())
      .run();
    expect((await call('POST', '/v1/shop/items/frame-v2_dragon_coil/buy', { token: ola.token })).status).toBe(200);
    const ap = await call('PUT', '/v1/me/appearance', { token: ola.token, json: { avatarItemId: null, frameItemId: 'frame-v2_dragon_coil' } });
    expect(ap.status).toBe(200);
    expect(ap.body.frameUrl).toMatch(/\/builtin\/frames-v2\/dragon_coil\.webp$/);
  });
});
