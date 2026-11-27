import { addDays, localDateAt, seededRng, zonedToEpoch } from '@choreapp/core';
import { afterEach, describe, expect, it } from 'vitest';
import { rewardRng } from '../src/services/rewards.js';
import { addChild, call, env, registerFamily, type Family } from './helpers.js';

const TZ = 'Europe/Warsaw';
const today = () => localDateAt(Date.now(), TZ);
let op = 0;
const opId = () => `p-${Date.now()}-${op++}`;

afterEach(() => {
  rewardRng.rng = Math.random;
});

/** A family pack with the given number of stickers per rarity. */
async function seedPack(familyId: string, counts: { common?: number; rare?: number; legendary?: number }, prefix = 'S') {
  const packId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO pack (id, family_id, name, source, license, active, created_at) VALUES (?, ?, 'Test', 'własne', 'private', 1, ?)",
  )
    .bind(packId, familyId, Date.now())
    .run();
  for (const [rarity, n] of Object.entries(counts)) {
    for (let i = 0; i < (n ?? 0); i++) {
      await env.DB.prepare(
        "INSERT INTO item (id, pack_id, kind, name, album, rarity, image_key, price, droppable) VALUES (?, ?, 'sticker', ?, 'Album', ?, 'k', 0, 1)",
      )
        .bind(crypto.randomUUID(), packId, `${prefix}-${rarity}-${i}`, rarity)
        .run();
    }
  }
  return packId;
}

/** Switches off every built-in pack for the family, so only the test's own pack can drop. */
async function isolate(familyId: string) {
  await env.DB.prepare(
    'INSERT OR REPLACE INTO pack_setting (family_id, pack_id, active) SELECT ?, id, 0 FROM pack WHERE family_id IS NULL',
  )
    .bind(familyId)
    .run();
}

async function setup() {
  const fam = await registerFamily();
  await isolate(fam.familyId);
  const ola = await addChild(fam, 'Ola');
  const kuba = await addChild(fam, 'Kuba');
  return { fam, ola, kuba };
}

async function createTask(fam: Family, assignees: string[], extra: Record<string, unknown> = {}) {
  return (
    await call('POST', '/v1/tasks', {
      token: fam.parentToken,
      json: { title: 'Zadanie', icon: 'broom', assignees, startDate: today(), recurrence: { kind: 'once' }, points: 10, ...extra },
    })
  ).body;
}

async function reportAndApprove(fam: Family, child: { token: string }, occurrenceId: string) {
  const rep = await call('POST', `/v1/occurrences/${occurrenceId}/report`, { token: child.token, json: { clientOpId: opId() } });
  return call('POST', `/v1/completions/${rep.body.completionId}/approve`, { token: fam.parentToken });
}

/** Writes past days of a daily task as approved on time (what would have happened). */
async function backfillDays(taskId: string, memberId: string, reviewerId: string, days: number) {
  for (let d = days; d >= 1; d--) {
    const date = addDays(today(), -d);
    const occId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO occurrence (id, task_id, date) VALUES (?, ?, ?)').bind(occId, taskId, date).run();
    const at = zonedToEpoch(date, '17:00', TZ);
    await env.DB.prepare(
      "INSERT INTO completion (id, occurrence_id, member_id, status, reported_at, reviewed_at, reviewed_by) VALUES (?, ?, ?, 'approved', ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), occId, memberId, at, at + 60_000, reviewerId)
      .run();
  }
}

describe('points', () => {
  it('balance is the sum of the ledger, with labels', async () => {
    const { fam, ola } = await setup();
    rewardRng.rng = () => 0.99; // only the guaranteed first-of-day drop
    await createTask(fam, [ola.id], { title: 'Pościel łóżko', points: 5 });
    await createTask(fam, [ola.id], { title: 'Lekcje', points: 20 });
    const items = (await call('GET', '/v1/agenda', { token: ola.token })).body.items;
    for (const i of items) await reportAndApprove(fam, ola, i.occurrenceId);
    const p = await call('GET', '/v1/members/me/points', { token: ola.token });
    expect(p.status).toBe(200);
    // No sticker pool in this family: the first-of-day drop pays 5 bonus points.
    expect(p.body.balance).toBe(30);
    expect(p.body.earnedTotal).toBe(30);
    const labels = p.body.ledger.map((l: any) => l.label);
    expect(labels).toContain('Pościel łóżko');
    expect(labels).toContain('Lekcje');
    expect(labels).toContain('Bonus: wszystkie naklejki zebrane');
  });

  it('a child cannot see a sibling’s points; a parent can', async () => {
    const { fam, ola, kuba } = await setup();
    expect((await call('GET', `/v1/members/${kuba.id}/points`, { token: ola.token })).status).toBe(403);
    expect((await call('GET', `/v1/members/${kuba.id}/points`, { token: fam.parentToken })).status).toBe(200);
  });
});

describe('streak', () => {
  it('counts consecutive days done on time', async () => {
    const { fam, ola } = await setup();
    const task = await createTask(fam, [ola.id], { recurrence: { kind: 'daily' }, startDate: addDays(today(), -3) });
    await backfillDays(task.id, ola.id, fam.parentId, 3);
    const p = await call('GET', `/v1/members/${ola.id}/points`, { token: fam.parentToken });
    expect(p.body.streak).toMatchObject({ current: 3, longest: 3, nextPack: { threshold: 7, daysLeft: 4, rarity: 'rare' } });
  });

  it('a day missed breaks the streak but late work still pays full points', async () => {
    const { fam, ola } = await setup();
    const task = await createTask(fam, [ola.id], { recurrence: { kind: 'daily' }, startDate: addDays(today(), -3), points: 20 });
    await backfillDays(task.id, ola.id, fam.parentId, 3);
    // Yesterday's occurrence: undo its completion -> overdue.
    await env.DB.prepare(
      'DELETE FROM completion WHERE occurrence_id = (SELECT id FROM occurrence WHERE task_id = ? AND date = ?)',
    )
      .bind(task.id, addDays(today(), -1))
      .run();
    expect((await call('GET', `/v1/members/${ola.id}/points`, { token: fam.parentToken })).body.streak.current).toBe(0);
    const overdue = (await call('GET', '/v1/agenda?overdue=1', { token: ola.token })).body.items.find((i: any) => i.date < today());
    const r = await reportAndApprove(fam, ola, overdue.occurrenceId);
    expect(r.body.drop.points).toBe(20);
    const p = await call('GET', `/v1/members/${ola.id}/points`, { token: fam.parentToken });
    expect(p.body.streak.current).toBe(0);
    expect(p.body.streak.longest).toBe(2);
  });
});

describe('random stickers', () => {
  it('first approval of the day always drops a sticker, never a repeat', async () => {
    const { fam, ola } = await setup();
    await seedPack(fam.familyId, { common: 3, rare: 1, legendary: 1 });
    await createTask(fam, [ola.id]);
    rewardRng.rng = seededRng(5);
    const item = (await call('GET', '/v1/agenda', { token: ola.token })).body.items[0];
    const r = await reportAndApprove(fam, ola, item.occurrenceId);
    expect(r.body.drop.items).toHaveLength(1);
    expect(r.body.drop.items[0].imageUrl).toContain('/v1/files/');
    const owned = await env.DB.prepare('SELECT COUNT(*) AS n FROM member_item WHERE member_id = ?').bind(ola.id).first<any>();
    expect(owned.n).toBe(1);
  });

  it('later approvals drop with 1 in 4 chance', async () => {
    const { fam, ola } = await setup();
    await seedPack(fam.familyId, { common: 50 });
    for (let i = 0; i < 3; i++) await createTask(fam, [ola.id], { title: `T${i}` });
    const items = (await call('GET', '/v1/agenda', { token: ola.token })).body.items;
    rewardRng.rng = () => 0.99; // never below 0.25
    const results = [];
    for (const i of items) results.push((await reportAndApprove(fam, ola, i.occurrenceId)).body.drop.items.length);
    expect(results).toEqual([1, 0, 0]);
  });

  it('tells the child why each new sticker came (first task of the day, bonus)', async () => {
    const { fam, ola } = await setup();
    await seedPack(fam.familyId, { common: 10 });
    for (let i = 0; i < 2; i++) await createTask(fam, [ola.id], { title: `T${i}` });
    const items = (await call('GET', '/v1/agenda', { token: ola.token })).body.items;
    rewardRng.rng = () => 0.1; // always drop
    for (const i of items) await reportAndApprove(fam, ola, i.occurrenceId);
    const fresh = (await call('GET', '/v1/collection/new', { token: ola.token })).body;
    expect(fresh.map((f: any) => [f.how, f.reason, f.streakDays])).toEqual([
      ['drop', 'first_task', null],
      ['drop', 'bonus_task', null],
    ]);
    expect(new Set(fresh.map((f: any) => f.bundle)).size).toBe(2);
  });

  it('pays 5 points when every sticker is collected', async () => {
    const { fam, ola } = await setup();
    await seedPack(fam.familyId, { common: 1 });
    await createTask(fam, [ola.id], { title: 'A' });
    await createTask(fam, [ola.id], { title: 'B' });
    const items = (await call('GET', '/v1/agenda', { token: ola.token })).body.items;
    rewardRng.rng = () => 0.1; // always drop
    const a = await reportAndApprove(fam, ola, items[0].occurrenceId);
    expect(a.body.drop.items).toHaveLength(1);
    const b = await reportAndApprove(fam, ola, items[1].occurrenceId);
    expect(b.body.drop.items).toHaveLength(0);
    expect(b.body.drop.fallbackPoints).toBe(5);
  });

  it('switched-off packs are not in the pool', async () => {
    const { fam, ola } = await setup();
    const packId = await seedPack(fam.familyId, { common: 5 });
    await env.DB.prepare('UPDATE pack SET active = 0 WHERE id = ?').bind(packId).run();
    await createTask(fam, [ola.id]);
    const item = (await call('GET', '/v1/agenda', { token: ola.token })).body.items[0];
    const r = await reportAndApprove(fam, ola, item.occurrenceId);
    expect(r.body.drop.items).toHaveLength(0);
    expect(r.body.drop.fallbackPoints).toBe(5);
  });
});

describe('streak packs', () => {
  it('7 days in a row give a pack of 3 with a guaranteed rare, once', async () => {
    const { fam, ola } = await setup();
    await seedPack(fam.familyId, { common: 20, rare: 5, legendary: 2 });
    const task = await createTask(fam, [ola.id], { recurrence: { kind: 'daily' }, startDate: addDays(today(), -6) });
    await backfillDays(task.id, ola.id, fam.parentId, 6);
    rewardRng.rng = seededRng(11);
    const item = (await call('GET', '/v1/agenda', { token: ola.token })).body.items[0];
    const r = await reportAndApprove(fam, ola, item.occurrenceId);
    expect(r.body.drop.streakPack).toEqual({ threshold: 7 });
    const streakItems = await env.DB.prepare(
      "SELECT i.rarity FROM member_item mi JOIN item i ON i.id = mi.item_id WHERE mi.member_id = ? AND mi.how = 'streak'",
    )
      .bind(ola.id)
      .all<any>();
    expect(streakItems.results).toHaveLength(3);
    expect(streakItems.results.some((i: any) => i.rarity === 'rare')).toBe(true);
    // Drop + pack: 4 distinct stickers in total, no repeats.
    const all = await env.DB.prepare('SELECT COUNT(DISTINCT item_id) AS n, COUNT(*) AS c FROM member_item WHERE member_id = ?').bind(ola.id).first<any>();
    expect(all.n).toBe(all.c);
    expect(all.c).toBe(4);
    const awards = await env.DB.prepare('SELECT * FROM streak_award WHERE member_id = ?').bind(ola.id).all();
    expect(awards.results).toHaveLength(1);
    // The reveal shows the pack with its reason; the 3 stickers share one pack.
    const fresh = (await call('GET', '/v1/collection/new', { token: ola.token })).body;
    const pack = fresh.filter((f: any) => f.reason === 'streak');
    expect(pack).toHaveLength(3);
    expect(pack.every((f: any) => f.streakDays === 7 && f.bundle === pack[0].bundle)).toBe(true);
    expect(fresh.filter((f: any) => f.reason === 'first_task')).toHaveLength(1);
  });

  it('30 days give a guaranteed legendary', async () => {
    const { fam, ola } = await setup();
    await seedPack(fam.familyId, { common: 40, rare: 10, legendary: 3 });
    const task = await createTask(fam, [ola.id], { recurrence: { kind: 'daily' }, startDate: addDays(today(), -29) });
    await backfillDays(task.id, ola.id, fam.parentId, 29);
    // Pretend 7 and 14 were already given during this streak.
    for (const t of [7, 14]) {
      await env.DB.prepare('INSERT INTO streak_award (id, member_id, threshold, streak_start, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), ola.id, t, addDays(today(), -29), Date.now())
        .run();
    }
    rewardRng.rng = seededRng(3);
    const item = (await call('GET', '/v1/agenda', { token: ola.token })).body.items[0];
    const r = await reportAndApprove(fam, ola, item.occurrenceId);
    expect(r.body.drop.streakPack).toEqual({ threshold: 30 });
    const leg = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM member_item mi JOIN item i ON i.id = mi.item_id WHERE mi.member_id = ? AND mi.how = 'streak' AND i.rarity = 'legendary'",
    )
      .bind(ola.id)
      .first<any>();
    expect(leg.n).toBeGreaterThanOrEqual(1);
  });
});

describe('stats', () => {
  it('shows history, on-time rate and sticker progress', async () => {
    const { fam, ola } = await setup();
    await seedPack(fam.familyId, { common: 4 });
    const task = await createTask(fam, [ola.id], { recurrence: { kind: 'daily' }, startDate: addDays(today(), -4), title: 'Codzienne' });
    await backfillDays(task.id, ola.id, fam.parentId, 4);
    await env.DB.prepare('DELETE FROM completion WHERE occurrence_id = (SELECT id FROM occurrence WHERE task_id = ? AND date = ?)')
      .bind(task.id, addDays(today(), -2))
      .run();
    const s = await call('GET', `/v1/members/${ola.id}/stats`, { token: fam.parentToken });
    expect(s.status).toBe(200);
    expect(s.body.onTimeRate30).toBeCloseTo(0.75);
    expect(s.body.approvedCount30).toBe(3);
    expect(s.body.history.map((h: any) => h.status)).toEqual(['approved', 'missed', 'approved', 'approved']);
    expect(s.body.stickersTotal).toBe(4);
  });
});

describe('bonus points from a parent ("Daj punkty")', () => {
  const give = (fam: Family, memberId: string, json: Record<string, unknown>, token = fam.parentToken) =>
    call('POST', `/v1/members/${memberId}/bonus`, { token, json: { clientOpId: opId(), ...json } });

  it('adds the points with the reason, shows it in the history and notifies the child', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam, 'Zosia');
    const r = await give(fam, kid.id, { amount: 20, reason: '  pomoc babci ' });
    expect(r.status).toBe(201);
    expect(r.body.balance).toBe(20);
    expect(r.body.entry).toMatchObject({ amount: 20, reason: 'bonus', note: 'pomoc babci', label: 'Bonus od rodzica: pomoc babci' });
    const p = await call('GET', '/v1/members/me/points', { token: kid.token });
    expect(p.body.balance).toBe(20);
    expect(p.body.earnedTotal).toBe(20);
    expect(p.body.ledger[0]).toMatchObject({ reason: 'bonus', label: 'Bonus od rodzica: pomoc babci', amount: 20 });
    const n = await env.DB.prepare("SELECT title, body FROM notification_outbox WHERE member_id = ? AND type = 'bonus'").bind(kid.id).first<any>();
    expect(n).toMatchObject({ title: 'Bonus! +20 pkt', body: 'Za: pomoc babci' });
  });

  it('is idempotent per key', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const key = opId();
    const [a, b] = await Promise.all([
      give(fam, kid.id, { amount: 5, reason: 'x', clientOpId: key }),
      give(fam, kid.id, { amount: 5, reason: 'x', clientOpId: key }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.entry.id).toBe(b.body.entry.id);
    const p = await call('GET', `/v1/members/${kid.id}/points`, { token: fam.parentToken });
    expect(p.body.balance).toBe(5);
  });

  it('never subtracts and validates amount and reason', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    for (const json of [
      { amount: -5, reason: 'kara' },
      { amount: 0, reason: 'nic' },
      { amount: 501, reason: 'dużo' },
      { amount: 2.5, reason: 'pół' },
      { amount: 10, reason: '   ' },
      { amount: 10, reason: 'x'.repeat(61) },
    ]) {
      expect((await give(fam, kid.id, json)).status).toBe(400);
    }
    expect((await give(fam, kid.id, { amount: 500, reason: 'x'.repeat(60) })).status).toBe(201);
  });

  it('only parents, only own family children', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const other = await registerFamily('Inni');
    expect((await give(fam, kid.id, { amount: 5, reason: 'x' }, kid.token)).status).toBe(403);
    expect((await give(other, kid.id, { amount: 5, reason: 'x' })).status).toBe(404);
    expect((await give(fam, fam.parentId, { amount: 5, reason: 'x' })).status).toBe(404);
  });
});
