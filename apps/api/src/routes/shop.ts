/**
 * The shop (parent rewards + digital items), redemptions, the collection,
 * sticker packs and the licence list.
 */
import {
  itemUpdate,
  packInput,
  packUpdate,
  rewardInput,
  type AlbumDto,
  type CollectionDto,
  type LicenseDto,
  type PackDto,
  type RedemptionDto,
  type RewardDto,
  type ShopDto,
} from '@choreapp/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppBindings, AuthInfo, Env } from '../env.js';
import { requireChild, requireParent } from '../lib/auth.js';
import { newId } from '../lib/crypto.js';
import { all, first, isUniqueViolation, run } from '../lib/db.js';
import { IMAGE_TYPES, MAX_ITEM_BYTES } from '../lib/files.js';
import { ApiError, background, badRequest, body, conflict, forbidden, notFound, query } from '../lib/http.js';
import { itemDto, loadFamily, priceOf, type ItemRow } from '../lib/rows.js';
import { ACTIVE_PACKS, activeItems } from '../services/catalog.js';
import { notifyRewardChosen } from '../services/notify.js';
import { balances } from '../services/stats.js';

interface RewardRow {
  id: string;
  family_id: string;
  name: string;
  icon: string;
  cost: number;
  active: number;
  deleted_at: number | null;
}

interface PackRow {
  id: string;
  family_id: string | null;
  name: string;
  source: string;
  license: string;
  attribution: string | null;
  active: number;
  effective_active: number;
}

const rewardDto = (r: RewardRow): RewardDto => ({ id: r.id, name: r.name, icon: r.icon, cost: r.cost, active: !!r.active });

/**
 * Spends points atomically: the ledger row is only written while the balance
 * covers it, so two taps at once can never go below zero.
 */
async function spend(env: Env, memberId: string, cost: number, reason: 'shop' | 'reward', ref: { redemptionId?: string }): Promise<string> {
  const id = newId();
  const res = await env.DB.prepare(
    `INSERT INTO points_ledger (id, member_id, amount, reason, redemption_id, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6
      WHERE (SELECT COALESCE(SUM(amount), 0) FROM points_ledger WHERE member_id = ?2) >= ?7`,
  )
    .bind(id, memberId, -cost, reason, ref.redemptionId ?? null, Date.now(), cost)
    .run();
  if (res.meta.changes !== 1) throw new ApiError(409, 'insufficient_points');
  return id;
}

async function redemptions(env: Env, familyId: string, where: string, ...args: (string | number)[]): Promise<RedemptionDto[]> {
  const rows = await all<{
    id: string;
    reward_id: string;
    reward_name: string;
    reward_icon: string;
    member_id: string;
    member_name: string;
    cost: number;
    status: RedemptionDto['status'];
    created_at: number;
    resolved_at: number | null;
  }>(
    env.DB,
    `SELECT r.id, r.reward_id, rw.name AS reward_name, rw.icon AS reward_icon, r.member_id, m.name AS member_name,
            r.cost, r.status, r.created_at, r.resolved_at
       FROM redemption r JOIN reward rw ON rw.id = r.reward_id JOIN member m ON m.id = r.member_id
      WHERE rw.family_id = ? ${where}
      ORDER BY r.created_at DESC LIMIT 100`,
    familyId,
    ...args,
  );
  return rows.map((r) => ({
    id: r.id,
    rewardId: r.reward_id,
    rewardName: r.reward_name,
    rewardIcon: r.reward_icon,
    memberId: r.member_id,
    memberName: r.member_name,
    cost: r.cost,
    status: r.status,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  }));
}

async function loadPack(env: Env, familyId: string, id: string): Promise<PackRow> {
  const p = await first<PackRow>(
    env.DB,
    `SELECT p.*, COALESCE(ps.active, p.active) AS effective_active FROM pack p
       LEFT JOIN pack_setting ps ON ps.pack_id = p.id AND ps.family_id = ?1
      WHERE p.id = ?2 AND (p.family_id = ?1 OR p.family_id IS NULL)`,
    familyId,
    id,
  );
  if (!p) throw notFound();
  return p;
}

async function ownedIds(env: Env, memberId: string): Promise<Map<string, number | null>> {
  const rows = await all<{ item_id: string; seen_at: number | null }>(env.DB, 'SELECT item_id, seen_at FROM member_item WHERE member_id = ?', memberId);
  return new Map(rows.map((r) => [r.item_id, r.seen_at]));
}

/** A child sees only themselves; an adult any member of their own family (another family's id is "not found"). */
async function childOrSelf(env: Env, auth: AuthInfo, id: string): Promise<string> {
  const memberId = id === 'me' ? auth.memberId : id;
  if (auth.role === 'child' && memberId !== auth.memberId) throw forbidden();
  if (memberId !== auth.memberId) {
    const m = await first(env.DB, 'SELECT 1 FROM member WHERE id = ? AND family_id = ?', memberId, auth.familyId);
    if (!m) throw notFound('member_not_found');
  }
  return memberId;
}

const uploadQuery = z.object({
  name: z.string().trim().min(1).max(60),
  album: z.string().trim().min(1).max(60),
  rarity: z.enum(['common', 'rare', 'legendary']),
  kind: z.enum(['sticker', 'avatar', 'frame']).default('sticker'),
  /** "drop" = only from drops, "shop" = only for sale, "both". */
  availability: z.enum(['drop', 'shop', 'both']).default('drop'),
});

export const shop = new Hono<AppBindings>()
  // -------------------------------------------------------------------------
  // Shop
  // -------------------------------------------------------------------------
  .get('/shop', async (c) => {
    const auth = c.get('auth');
    // An adult may look at the shop as one of their children (?member=); without it there is no balance.
    const asMember = c.req.query('member');
    const memberId = auth.role === 'child' ? auth.memberId : asMember ? await childOrSelf(c.env, auth, asMember) : '';
    const family = await loadFamily(c.env, auth.familyId);
    const origin = new URL(c.req.url).origin;
    const [rewards, items, owned, b, pending] = await Promise.all([
      all<RewardRow>(c.env.DB, 'SELECT * FROM reward WHERE family_id = ? AND active = 1 AND deleted_at IS NULL ORDER BY cost', family.id),
      activeItems(c.env.DB, family.id),
      ownedIds(c.env, memberId),
      balances(c.env.DB, memberId),
      redemptions(c.env, family.id, "AND r.member_id = ? AND r.status = 'requested'", memberId),
    ]);
    const forSale = items.filter((i) => priceOf(i, family) !== null);
    const dto: ShopDto = {
      balance: b.balance,
      rewards: rewards.map(rewardDto),
      items: await Promise.all(forSale.map(async (i) => ({ ...(await itemDto(c.env, origin, i, family)), owned: owned.has(i.id) }))),
      pending,
    };
    return c.json(dto);
  })

  .post('/shop/items/:id/buy', requireChild, async (c) => {
    const { familyId, memberId } = c.get('auth');
    const family = await loadFamily(c.env, familyId);
    const item = await first<ItemRow>(
      c.env.DB,
      `SELECT * FROM item WHERE id = ?2 AND deleted_at IS NULL AND pack_id IN (${ACTIVE_PACKS})`,
      familyId,
      c.req.param('id'),
    );
    if (!item) throw notFound();
    const price = priceOf(item, family);
    if (price === null) throw conflict('not_for_sale');
    if (await first(c.env.DB, 'SELECT 1 FROM member_item WHERE member_id = ? AND item_id = ?', memberId, item.id)) throw conflict('already_owned');

    const ledgerId = await spend(c.env, memberId, price, 'shop', {});
    const memberItemId = newId();
    try {
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO member_item (id, member_id, item_id, acquired_at, how, seen_at) VALUES (?, ?, ?, ?, 'shop', ?)").bind(
          memberItemId,
          memberId,
          item.id,
          Date.now(),
          Date.now(),
        ),
        c.env.DB.prepare('UPDATE points_ledger SET member_item_id = ? WHERE id = ?').bind(memberItemId, ledgerId),
      ]);
    } catch (e) {
      // Bought twice at the same moment: give the points back.
      await run(c.env.DB, 'DELETE FROM points_ledger WHERE id = ?', ledgerId);
      if (isUniqueViolation(e)) throw conflict('already_owned');
      throw e;
    }
    return c.json({ ok: true, balance: (await balances(c.env.DB, memberId)).balance });
  })

  // -------------------------------------------------------------------------
  // Parent rewards
  // -------------------------------------------------------------------------
  .get('/rewards', requireParent, async (c) => {
    const rows = await all<RewardRow>(
      c.env.DB,
      'SELECT * FROM reward WHERE family_id = ? AND deleted_at IS NULL ORDER BY active DESC, cost',
      c.get('auth').familyId,
    );
    return c.json(rows.map(rewardDto));
  })

  .post('/rewards', requireParent, async (c) => {
    const b = await body(c, rewardInput);
    const id = newId();
    await run(
      c.env.DB,
      'INSERT INTO reward (id, family_id, name, icon, cost, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      c.get('auth').familyId,
      b.name,
      b.icon,
      b.cost,
      b.active ? 1 : 0,
      Date.now(),
    );
    return c.json(rewardDto((await first<RewardRow>(c.env.DB, 'SELECT * FROM reward WHERE id = ?', id))!), 201);
  })

  .patch('/rewards/:id', requireParent, async (c) => {
    const b = await body(c, rewardInput);
    const res = await run(
      c.env.DB,
      'UPDATE reward SET name = ?, icon = ?, cost = ?, active = ? WHERE id = ? AND family_id = ? AND deleted_at IS NULL',
      b.name,
      b.icon,
      b.cost,
      b.active ? 1 : 0,
      c.req.param('id'),
      c.get('auth').familyId,
    );
    if (res.meta.changes !== 1) throw notFound();
    return c.json(rewardDto((await first<RewardRow>(c.env.DB, 'SELECT * FROM reward WHERE id = ?', c.req.param('id')))!));
  })

  .delete('/rewards/:id', requireParent, async (c) => {
    await run(c.env.DB, 'UPDATE reward SET deleted_at = ?, active = 0 WHERE id = ? AND family_id = ?', Date.now(), c.req.param('id'), c.get('auth').familyId);
    return c.json({ ok: true });
  })

  .post('/rewards/:id/redeem', requireChild, async (c) => {
    const { familyId, memberId } = c.get('auth');
    const family = await loadFamily(c.env, familyId);
    const reward = await first<RewardRow>(c.env.DB, 'SELECT * FROM reward WHERE id = ? AND family_id = ? AND deleted_at IS NULL', c.req.param('id'), familyId);
    if (!reward) throw notFound();
    if (!reward.active) throw conflict('reward_inactive');
    const redemptionId = newId();
    await run(
      c.env.DB,
      "INSERT INTO redemption (id, reward_id, member_id, cost, status, created_at) VALUES (?, ?, ?, ?, 'requested', ?)",
      redemptionId,
      reward.id,
      memberId,
      reward.cost,
      Date.now(),
    );
    try {
      await spend(c.env, memberId, reward.cost, 'reward', { redemptionId });
    } catch (e) {
      await run(c.env.DB, 'DELETE FROM redemption WHERE id = ?', redemptionId);
      throw e;
    }
    await background(c, notifyRewardChosen(c.env, family, memberId, reward.name, reward.cost));
    return c.json({ ok: true, redemptionId, balance: (await balances(c.env.DB, memberId)).balance }, 201);
  })

  .get('/redemptions', async (c) => {
    const auth = c.get('auth');
    const q = query(c, z.object({ status: z.enum(['requested', 'delivered', 'cancelled']).optional() }));
    const where: string[] = [];
    const args: string[] = [];
    if (auth.role === 'child') {
      where.push('AND r.member_id = ?');
      args.push(auth.memberId);
    }
    if (q.status) {
      where.push('AND r.status = ?');
      args.push(q.status);
    }
    return c.json(await redemptions(c.env, auth.familyId, where.join(' '), ...args));
  })

  .post('/redemptions/:id/deliver', requireParent, async (c) => {
    const { familyId, memberId } = c.get('auth');
    const res = await run(
      c.env.DB,
      `UPDATE redemption SET status = 'delivered', resolved_at = ?, resolved_by = ?
        WHERE id = ? AND status = 'requested' AND reward_id IN (SELECT id FROM reward WHERE family_id = ?)`,
      Date.now(),
      memberId,
      c.req.param('id'),
      familyId,
    );
    if (res.meta.changes !== 1) throw conflict('not_pending');
    return c.json({ ok: true });
  })

  /** Parent declines a chosen reward: the points go back to the child. */
  .post('/redemptions/:id/cancel', requireParent, async (c) => {
    const { familyId, memberId } = c.get('auth');
    const r = await first<{ id: string; member_id: string; cost: number }>(
      c.env.DB,
      `SELECT r.id, r.member_id, r.cost FROM redemption r JOIN reward rw ON rw.id = r.reward_id
        WHERE r.id = ? AND rw.family_id = ? AND r.status = 'requested'`,
      c.req.param('id'),
      familyId,
    );
    if (!r) throw conflict('not_pending');
    const now = Date.now();
    const res = await run(
      c.env.DB,
      "UPDATE redemption SET status = 'cancelled', resolved_at = ?, resolved_by = ? WHERE id = ? AND status = 'requested'",
      now,
      memberId,
      r.id,
    );
    if (res.meta.changes !== 1) throw conflict('not_pending');
    await run(
      c.env.DB,
      "INSERT INTO points_ledger (id, member_id, amount, reason, redemption_id, created_at) VALUES (?, ?, ?, 'reward_refund', ?, ?)",
      newId(),
      r.member_id,
      r.cost,
      r.id,
      now,
    );
    return c.json({ ok: true });
  })

  // -------------------------------------------------------------------------
  // Collection
  // -------------------------------------------------------------------------
  .get('/members/:id/collection', async (c) => {
    const auth = c.get('auth');
    const memberId = await childOrSelf(c.env, auth, c.req.param('id'));
    const family = await loadFamily(c.env, auth.familyId);
    const origin = new URL(c.req.url).origin;
    const owned = await ownedIds(c.env, memberId);
    const active = await activeItems(c.env.DB, family.id);
    // Owned items stay visible even if their pack was later switched off.
    const missing = [...owned.keys()].filter((id) => !active.some((i) => i.id === id));
    const extra = missing.length
      ? await all<ItemRow>(c.env.DB, `SELECT * FROM item WHERE id IN (${missing.map(() => '?').join(', ')})`, ...missing)
      : [];
    const items = [...active, ...extra];
    const toDto = async (i: ItemRow) => ({
      ...(await itemDto(c.env, origin, i, family)),
      owned: owned.has(i.id),
      isNew: owned.has(i.id) && owned.get(i.id) === null,
    });

    const albums = new Map<string, AlbumDto>();
    for (const i of items.filter((x) => x.kind === 'sticker')) {
      const a = albums.get(i.album) ?? { name: i.album, owned: 0, total: 0, items: [] };
      a.items.push(await toDto(i));
      a.total++;
      if (owned.has(i.id)) a.owned++;
      albums.set(i.album, a);
    }
    const dto: CollectionDto = {
      albums: [...albums.values()],
      avatars: await Promise.all(items.filter((i) => i.kind === 'avatar').map(toDto)),
      frames: await Promise.all(items.filter((i) => i.kind === 'frame').map(toDto)),
    };
    return c.json(dto);
  })

  /** Items the child got but has not seen yet (for the reveal animation). */
  .get('/collection/new', requireChild, async (c) => {
    const { familyId, memberId } = c.get('auth');
    const family = await loadFamily(c.env, familyId);
    const rows = await all<ItemRow & { how: string }>(
      c.env.DB,
      `SELECT i.*, mi.how FROM member_item mi JOIN item i ON i.id = mi.item_id
        WHERE mi.member_id = ? AND mi.seen_at IS NULL ORDER BY mi.acquired_at`,
      memberId,
    );
    const origin = new URL(c.req.url).origin;
    return c.json(await Promise.all(rows.map(async (r) => ({ ...(await itemDto(c.env, origin, r, family)), how: r.how }))));
  })

  /** Marks new stickers as seen (after the reveal animation). */
  .post('/collection/seen', requireChild, async (c) => {
    await run(c.env.DB, 'UPDATE member_item SET seen_at = ? WHERE member_id = ? AND seen_at IS NULL', Date.now(), c.get('auth').memberId);
    return c.json({ ok: true });
  })

  // -------------------------------------------------------------------------
  // Packs (parent panel)
  // -------------------------------------------------------------------------
  .get('/packs', requireParent, async (c) => {
    const familyId = c.get('auth').familyId;
    const rows = await all<PackRow & { item_count: number; albums: string | null }>(
      c.env.DB,
      `SELECT p.*, COALESCE(ps.active, p.active) AS effective_active,
              (SELECT COUNT(*) FROM item i WHERE i.pack_id = p.id AND i.deleted_at IS NULL) AS item_count,
              (SELECT GROUP_CONCAT(DISTINCT i.album) FROM item i WHERE i.pack_id = p.id AND i.deleted_at IS NULL) AS albums
         FROM pack p LEFT JOIN pack_setting ps ON ps.pack_id = p.id AND ps.family_id = ?1
        WHERE p.family_id = ?1 OR p.family_id IS NULL
        ORDER BY p.family_id IS NULL, p.name`,
      familyId,
    );
    const dto: PackDto[] = rows.map((p) => ({
      id: p.id,
      name: p.name,
      source: p.source,
      license: p.license,
      attribution: p.attribution,
      builtIn: p.family_id === null,
      active: !!p.effective_active,
      itemCount: p.item_count,
      albums: p.albums ? p.albums.split(',') : [],
    }));
    return c.json(dto);
  })

  .post('/packs', requireParent, async (c) => {
    const b = await body(c, packInput);
    const id = newId();
    await run(
      c.env.DB,
      'INSERT INTO pack (id, family_id, name, source, license, attribution, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      c.get('auth').familyId,
      b.name,
      b.source,
      b.license,
      b.attribution ?? null,
      b.active ? 1 : 0,
      Date.now(),
    );
    return c.json({ id }, 201);
  })

  .patch('/packs/:id', requireParent, async (c) => {
    const b = await body(c, packUpdate);
    const familyId = c.get('auth').familyId;
    const p = await loadPack(c.env, familyId, c.req.param('id'));
    if (p.family_id === null) {
      // Built-in packs: the family can only switch them on or off.
      if (b.name || b.source || b.license || b.attribution !== undefined) throw forbidden('pack_builtin');
      if (b.active !== undefined) {
        await run(
          c.env.DB,
          'INSERT INTO pack_setting (family_id, pack_id, active) VALUES (?, ?, ?) ON CONFLICT(family_id, pack_id) DO UPDATE SET active = excluded.active',
          familyId,
          p.id,
          b.active ? 1 : 0,
        );
      }
    } else {
      await run(
        c.env.DB,
        'UPDATE pack SET name = ?, source = ?, license = ?, attribution = ?, active = ? WHERE id = ?',
        b.name ?? p.name,
        b.source ?? p.source,
        b.license ?? p.license,
        b.attribution !== undefined ? (b.attribution ?? null) : p.attribution,
        b.active !== undefined ? (b.active ? 1 : 0) : p.active,
        p.id,
      );
    }
    return c.json({ ok: true });
  })

  .get('/packs/:id/items', requireParent, async (c) => {
    const family = await loadFamily(c.env, c.get('auth').familyId);
    const p = await loadPack(c.env, family.id, c.req.param('id'));
    const items = await all<ItemRow>(c.env.DB, 'SELECT * FROM item WHERE pack_id = ? AND deleted_at IS NULL ORDER BY album, sort, name', p.id);
    const origin = new URL(c.req.url).origin;
    return c.json(await Promise.all(items.map((i) => itemDto(c.env, origin, i, family))));
  })

  /** One image per request; the panel uploads a batch one by one. */
  .post('/packs/:id/items', requireParent, async (c) => {
    const family = await loadFamily(c.env, c.get('auth').familyId);
    const p = await loadPack(c.env, family.id, c.req.param('id'));
    if (p.family_id === null) throw forbidden('pack_builtin');
    const q = query(c, uploadQuery);
    const type = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim();
    const ext = IMAGE_TYPES[type];
    if (!ext) throw badRequest('unsupported_image_type');
    const data = await c.req.arrayBuffer();
    if (data.byteLength === 0) throw badRequest('empty_image');
    if (data.byteLength > MAX_ITEM_BYTES) throw new ApiError(413, 'image_too_large');
    const id = newId();
    const key = `families/${family.id}/packs/${p.id}/${id}.${ext}`;
    await c.env.FILES.put(key, data, { httpMetadata: { contentType: type } });
    const price = q.availability === 'drop' ? null : 0;
    const droppable = q.kind === 'sticker' && q.availability !== 'shop' ? 1 : 0;
    await run(
      c.env.DB,
      'INSERT INTO item (id, pack_id, kind, name, album, rarity, image_key, price, droppable, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      p.id,
      q.kind,
      q.name,
      q.album,
      q.rarity,
      key,
      // Avatars and frames never drop, so they must be for sale.
      q.kind === 'sticker' ? price : 0,
      droppable,
      Date.now() % 1_000_000,
    );
    const item = (await first<ItemRow>(c.env.DB, 'SELECT * FROM item WHERE id = ?', id))!;
    return c.json(await itemDto(c.env, new URL(c.req.url).origin, item, family), 201);
  })

  .patch('/items/:id', requireParent, async (c) => {
    const b = await body(c, itemUpdate);
    const family = await loadFamily(c.env, c.get('auth').familyId);
    const item = await first<ItemRow & { family_id: string | null }>(
      c.env.DB,
      'SELECT i.*, p.family_id FROM item i JOIN pack p ON p.id = i.pack_id WHERE i.id = ? AND i.deleted_at IS NULL',
      c.req.param('id'),
    );
    if (!item || item.family_id !== family.id) throw item?.family_id === null ? forbidden('pack_builtin') : notFound();
    await run(
      c.env.DB,
      'UPDATE item SET name = ?, album = ?, rarity = ?, kind = ?, price = ?, droppable = ? WHERE id = ?',
      b.name ?? item.name,
      b.album ?? item.album,
      b.rarity ?? item.rarity,
      b.kind ?? item.kind,
      b.price !== undefined ? b.price : item.price,
      b.droppable !== undefined ? (b.droppable ? 1 : 0) : item.droppable,
      item.id,
    );
    return c.json({ ok: true });
  })

  .delete('/items/:id', requireParent, async (c) => {
    const familyId = c.get('auth').familyId;
    const res = await run(
      c.env.DB,
      'UPDATE item SET deleted_at = ? WHERE id = ? AND pack_id IN (SELECT id FROM pack WHERE family_id = ?)',
      Date.now(),
      c.req.param('id'),
      familyId,
    );
    if (res.meta.changes !== 1) throw notFound();
    return c.json({ ok: true });
  })

  /** Sources and licences of everything the family's app shows. */
  .get('/licenses', async (c) => {
    const familyId = c.get('auth').familyId;
    const packs = await all<{ name: string; source: string; license: string; attribution: string | null }>(
      c.env.DB,
      `SELECT DISTINCT p.name, p.source, p.license, p.attribution FROM pack p
        WHERE p.id IN (${ACTIVE_PACKS})
           OR p.id IN (SELECT i.pack_id FROM item i JOIN member_item mi ON mi.item_id = i.id JOIN member m ON m.id = mi.member_id WHERE m.family_id = ?1)
        ORDER BY p.name`,
      familyId,
    );
    const dto: LicenseDto[] = [
      {
        pack: 'Ikonki zadań i nagród (wbudowane)',
        source: 'https://github.com/microsoft/fluentui-emoji',
        license: 'MIT',
        attribution: 'Fluent Emoji © Microsoft Corporation, licencja MIT',
      },
      ...packs.map((p) => ({ pack: p.name, source: p.source, license: p.license, attribution: p.attribution })),
    ];
    return c.json(dto);
  });

