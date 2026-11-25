import { localDateAt } from '@choreapp/core';
import { describe, expect, it } from 'vitest';
import { addChild, call, env, registerFamily, type Family } from './helpers.js';

async function setup() {
  const fam = await registerFamily();
  const ola = await addChild(fam, 'Ola');
  const kuba = await addChild(fam, 'Kuba');
  return { fam, ola, kuba };
}

async function give(memberId: string, amount: number) {
  await env.DB.prepare("INSERT INTO points_ledger (id, member_id, amount, reason, created_at) VALUES (?, ?, ?, 'task', ?)")
    .bind(crypto.randomUUID(), memberId, amount, Date.now())
    .run();
}

async function balance(token: string): Promise<number> {
  return (await call('GET', '/v1/members/me/points', { token })).body.balance;
}

/** Built-in pack shared by all families. */
async function builtInPack(items: { kind?: string; rarity: string; price: number | null; droppable?: number; album?: string }[]) {
  const packId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO pack (id, family_id, name, source, license, attribution, active, created_at) VALUES (?, NULL, 'Wbudowana', 'https://example.org', 'CC0-1.0', NULL, 1, ?)",
  )
    .bind(packId, Date.now())
    .run();
  const ids: string[] = [];
  for (const [n, i] of items.entries()) {
    const id = crypto.randomUUID();
    ids.push(id);
    await env.DB.prepare('INSERT INTO item (id, pack_id, kind, name, album, rarity, image_key, price, droppable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, packId, i.kind ?? 'sticker', `Item ${n}`, i.album ?? 'Zwierzaki', i.rarity, `builtin/${id}.svg`, i.price, i.droppable ?? 1)
      .run();
  }
  return { packId, ids };
}

async function addReward(fam: Family, name: string, cost: number) {
  return (await call('POST', '/v1/rewards', { token: fam.parentToken, json: { name, icon: 'gift', cost } })).body;
}

describe('parent rewards', () => {
  it('the rewards shelf is empty until the parent adds one', async () => {
    const { fam, ola } = await setup();
    expect((await call('GET', '/v1/shop', { token: ola.token })).body.rewards).toEqual([]);
    await addReward(fam, 'Godzina na konsoli', 100);
    const shop = await call('GET', '/v1/shop', { token: ola.token });
    expect(shop.body.rewards).toMatchObject([{ name: 'Godzina na konsoli', cost: 100 }]);
  });

  it('a child chooses a reward, points go down, the parent marks it delivered', async () => {
    const { fam, ola } = await setup();
    const reward = await addReward(fam, 'Kino', 50);
    await give(ola.id, 70);
    const r = await call('POST', `/v1/rewards/${reward.id}/redeem`, { token: ola.token });
    expect(r.status).toBe(201);
    expect(r.body.balance).toBe(20);
    const pending = await call('GET', '/v1/redemptions?status=requested', { token: fam.parentToken });
    expect(pending.body).toMatchObject([{ rewardName: 'Kino', memberName: 'Ola', cost: 50, status: 'requested' }]);
    expect((await call('POST', `/v1/redemptions/${r.body.redemptionId}/deliver`, { token: fam.parentToken })).status).toBe(200);
    expect((await call('GET', '/v1/redemptions?status=requested', { token: fam.parentToken })).body).toHaveLength(0);
  });

  it('cannot choose without enough points', async () => {
    const { fam, ola } = await setup();
    const reward = await addReward(fam, 'Kino', 50);
    await give(ola.id, 49);
    const r = await call('POST', `/v1/rewards/${reward.id}/redeem`, { token: ola.token });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('insufficient_points');
    expect(await balance(ola.token)).toBe(49);
    expect((await call('GET', '/v1/redemptions', { token: fam.parentToken })).body).toHaveLength(0);
  });

  it('never goes below zero when tapping twice at once', async () => {
    const { fam, ola } = await setup();
    const reward = await addReward(fam, 'Lody', 30);
    await give(ola.id, 40);
    const results = await Promise.all([
      call('POST', `/v1/rewards/${reward.id}/redeem`, { token: ola.token }),
      call('POST', `/v1/rewards/${reward.id}/redeem`, { token: ola.token }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await balance(ola.token)).toBe(10);
  });

  it('cancelling refunds the points', async () => {
    const { fam, ola } = await setup();
    const reward = await addReward(fam, 'Kino', 50);
    await give(ola.id, 50);
    const r = await call('POST', `/v1/rewards/${reward.id}/redeem`, { token: ola.token });
    await call('POST', `/v1/redemptions/${r.body.redemptionId}/cancel`, { token: fam.parentToken });
    expect(await balance(ola.token)).toBe(50);
    const ledger = (await call('GET', '/v1/members/me/points', { token: ola.token })).body.ledger.map((l: any) => l.label);
    expect(ledger).toContain('Zwrot: Kino');
    expect(ledger).toContain('Nagroda: Kino');
  });

  it('inactive and deleted rewards cannot be chosen', async () => {
    const { fam, ola } = await setup();
    const reward = await addReward(fam, 'Kino', 10);
    await give(ola.id, 100);
    await call('PATCH', `/v1/rewards/${reward.id}`, { token: fam.parentToken, json: { name: 'Kino', icon: 'gift', cost: 10, active: false } });
    expect((await call('POST', `/v1/rewards/${reward.id}/redeem`, { token: ola.token })).status).toBe(409);
    await call('DELETE', `/v1/rewards/${reward.id}`, { token: fam.parentToken });
    expect((await call('POST', `/v1/rewards/${reward.id}/redeem`, { token: ola.token })).status).toBe(404);
  });
});

describe('digital shop', () => {
  it('sells items at the family default price for their rarity', async () => {
    const { fam, ola } = await setup();
    const { ids } = await builtInPack([
      { rarity: 'common', price: 0, droppable: 0 },
      { rarity: 'rare', price: 0, droppable: 0 },
      { rarity: 'legendary', price: 0, droppable: 0 },
      { rarity: 'common', price: null },
    ]);
    const shop = await call('GET', '/v1/shop', { token: ola.token });
    const prices = Object.fromEntries(shop.body.items.filter((i: any) => ids.includes(i.id)).map((i: any) => [i.rarity, i.price]));
    expect(prices).toEqual({ common: 30, rare: 80, legendary: 200 });
    // Drop-only items are not for sale.
    expect(shop.body.items.some((i: any) => i.id === ids[3])).toBe(false);

    await call('PATCH', '/v1/family', { token: fam.parentToken, json: { priceRare: 60 } });
    const after = await call('GET', '/v1/shop', { token: ola.token });
    expect(after.body.items.find((i: any) => i.id === ids[1]).price).toBe(60);
  });

  it('buying puts the item in the collection and takes the points', async () => {
    const { ola } = await setup();
    const { ids } = await builtInPack([{ rarity: 'common', price: 0, droppable: 0, kind: 'avatar' }]);
    await give(ola.id, 35);
    const r = await call('POST', `/v1/shop/items/${ids[0]}/buy`, { token: ola.token });
    expect(r.status).toBe(200);
    expect(r.body.balance).toBe(5);
    const col = await call('GET', '/v1/members/me/collection', { token: ola.token });
    expect(col.body.avatars.find((a: any) => a.id === ids[0]).owned).toBe(true);
    expect((await call('POST', `/v1/shop/items/${ids[0]}/buy`, { token: ola.token })).body.error).toBe('already_owned');
    // Use it as the avatar.
    const ap = await call('PUT', '/v1/me/appearance', { token: ola.token, json: { avatarItemId: ids[0], frameItemId: null } });
    expect(ap.status).toBe(200);
    expect(ap.body.avatarItemId).toBe(ids[0]);
  });

  it('cannot wear items you do not own', async () => {
    const { ola } = await setup();
    const { ids } = await builtInPack([{ rarity: 'common', price: 0, droppable: 0, kind: 'frame' }]);
    const ap = await call('PUT', '/v1/me/appearance', { token: ola.token, json: { avatarItemId: null, frameItemId: ids[0] } });
    expect(ap.status).toBe(403);
  });

  it('cannot buy without enough points', async () => {
    const { ola } = await setup();
    const { ids } = await builtInPack([{ rarity: 'legendary', price: 0, droppable: 0 }]);
    await give(ola.id, 199);
    expect((await call('POST', `/v1/shop/items/${ids[0]}/buy`, { token: ola.token })).body.error).toBe('insufficient_points');
  });
});

describe('collection', () => {
  it('groups stickers into albums with "x of y" counters', async () => {
    const { fam, ola } = await setup();
    const { ids } = await builtInPack([
      { rarity: 'common', price: null, album: 'Zwierzaki' },
      { rarity: 'common', price: null, album: 'Zwierzaki' },
      { rarity: 'rare', price: null, album: 'Jedzenie' },
    ]);
    await env.DB.prepare("INSERT INTO member_item (id, member_id, item_id, acquired_at, how) VALUES (?, ?, ?, ?, 'drop')")
      .bind(crypto.randomUUID(), ola.id, ids[0], Date.now())
      .run();
    const col = await call('GET', '/v1/members/me/collection', { token: ola.token });
    const zw = col.body.albums.find((a: any) => a.name === 'Zwierzaki');
    expect(zw.owned).toBeGreaterThanOrEqual(1);
    expect(zw.items.find((i: any) => i.id === ids[0])).toMatchObject({ owned: true, isNew: true });
    await call('POST', '/v1/collection/seen', { token: ola.token });
    const again = await call('GET', '/v1/members/me/collection', { token: ola.token });
    expect(again.body.albums.find((a: any) => a.name === 'Zwierzaki').items.find((i: any) => i.id === ids[0]).isNew).toBe(false);
    // Parent can look at the child's collection too.
    expect((await call('GET', `/v1/members/${ola.id}/collection`, { token: fam.parentToken })).status).toBe(200);
  });

  it('owned stickers stay visible when their pack is switched off', async () => {
    const { fam, ola } = await setup();
    const { packId, ids } = await builtInPack([{ rarity: 'common', price: null, album: 'Wyłączone' }]);
    await env.DB.prepare("INSERT INTO member_item (id, member_id, item_id, acquired_at, how) VALUES (?, ?, ?, ?, 'drop')")
      .bind(crypto.randomUUID(), ola.id, ids[0], Date.now())
      .run();
    await call('PATCH', `/v1/packs/${packId}`, { token: fam.parentToken, json: { active: false } });
    const col = await call('GET', '/v1/members/me/collection', { token: ola.token });
    const album = col.body.albums.find((a: any) => a.name === 'Wyłączone');
    expect(album.items.map((i: any) => i.id)).toEqual([ids[0]]);
  });
});

describe('packs panel', () => {
  it('lists built-in packs with source and licence; a family can switch one off just for itself', async () => {
    const { fam } = await setup();
    const other = await registerFamily('Inni');
    const { packId } = await builtInPack([{ rarity: 'common', price: null }]);
    const list = await call('GET', '/v1/packs', { token: fam.parentToken });
    expect(list.body.find((p: any) => p.id === packId)).toMatchObject({ builtIn: true, active: true, license: 'CC0-1.0', itemCount: 1 });
    await call('PATCH', `/v1/packs/${packId}`, { token: fam.parentToken, json: { active: false } });
    expect((await call('GET', '/v1/packs', { token: fam.parentToken })).body.find((p: any) => p.id === packId).active).toBe(false);
    expect((await call('GET', '/v1/packs', { token: other.parentToken })).body.find((p: any) => p.id === packId).active).toBe(true);
    // Built-in metadata can't be edited.
    expect((await call('PATCH', `/v1/packs/${packId}`, { token: fam.parentToken, json: { name: 'Moja' } })).status).toBe(403);
  });

  it('a parent adds a private pack and uploads stickers into albums', async () => {
    const { fam, ola } = await setup();
    const pack = await call('POST', '/v1/packs', { token: fam.parentToken, json: { name: 'Rysunki Oli', source: 'własne', license: 'private' } });
    expect(pack.status).toBe(201);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    const up = await call('POST', `/v1/packs/${pack.body.id}/items?name=Kotek&album=Domowe&rarity=rare&availability=both`, {
      token: fam.parentToken,
      raw: svg,
      contentType: 'image/svg+xml',
    });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ name: 'Kotek', album: 'Domowe', rarity: 'rare', price: 80, droppable: true });
    const img = new URL(up.body.imageUrl);
    const file = await call('GET', img.pathname + img.search);
    expect(file.status).toBe(200);
    // Shows up in the child's shop and album.
    const shop = await call('GET', '/v1/shop', { token: ola.token });
    expect(shop.body.items.some((i: any) => i.name === 'Kotek')).toBe(true);
    const items = await call('GET', `/v1/packs/${pack.body.id}/items`, { token: fam.parentToken });
    expect(items.body).toHaveLength(1);
    await call('PATCH', `/v1/items/${up.body.id}`, { token: fam.parentToken, json: { price: null } });
    expect((await call('GET', '/v1/shop', { token: ola.token })).body.items.some((i: any) => i.name === 'Kotek')).toBe(false);
  });

  it('children cannot manage packs', async () => {
    const { ola } = await setup();
    expect((await call('POST', '/v1/packs', { token: ola.token, json: { name: 'x', source: 'y', license: 'z' } })).status).toBe(403);
  });

  it('licence list includes the built-in icons and active packs', async () => {
    const { ola } = await setup();
    await builtInPack([{ rarity: 'common', price: null }]);
    const l = await call('GET', '/v1/licenses', { token: ola.token });
    expect(l.body[0].license).toBe('MIT');
    expect(l.body.some((p: any) => p.license === 'CC0-1.0')).toBe(true);
  });
});

describe('notifications enqueue', () => {
  it('reward choice notifies parents through the outbox', async () => {
    const { fam, ola } = await setup();
    const reward = await addReward(fam, 'Kino', 10);
    await give(ola.id, 10);
    await call('POST', `/v1/rewards/${reward.id}/redeem`, { token: ola.token });
    const rows = await env.DB.prepare("SELECT * FROM notification_outbox WHERE member_id = ? AND type = 'reward'").bind(fam.parentId).all<any>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].title).toBe('Ola wybiera nagrodę');
  });
});

void localDateAt;
