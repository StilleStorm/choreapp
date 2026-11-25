import { localDateAt } from '@choreapp/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { addChild, call, env, legacyChildPhoto, registerFamily, uniqueEmail, type Family } from './helpers.js';

const PW = 'tajne-haslo-123';
let op = 0;

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM rate_limit').run();
});

async function addParent(fam: Family): Promise<{ token: string; id: string; email: string }> {
  const email = uniqueEmail();
  const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'parent' } });
  const r = await call('POST', '/v1/invites/redeem', { json: { token: inv.body.token, name: 'Tata', email, password: 'haslo-taty-123' } });
  if (r.status !== 201) throw new Error(`redeem failed: ${JSON.stringify(r.body)}`);
  return { token: r.body.token, id: r.body.me.id, email };
}

/** A family with real history: the second adult creates and approves a task, delivers a reward; the child has a pre-1.0.9 photo. */
async function busyFamily() {
  const fam = await registerFamily();
  const dad = await addParent(fam);
  const kid = await addChild(fam, 'Ola');
  const today = localDateAt(Date.now(), 'Europe/Warsaw');
  await call('POST', '/v1/tasks', {
    token: dad.token,
    json: { title: 'Pościel łóżko', icon: 'broom', assignees: [kid.id], startDate: today, recurrence: { kind: 'once' }, points: 10 },
  });
  const item = (await call('GET', '/v1/agenda', { token: kid.token })).body.items[0];
  const rep = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: kid.token, json: { clientOpId: `d-${Date.now()}-${op++}` } });
  await call('POST', `/v1/completions/${rep.body.completionId}/approve`, { token: dad.token });
  const reward = (await call('POST', '/v1/rewards', { token: fam.parentToken, json: { name: 'Lody', icon: 'gift', cost: 5 } })).body;
  const red = await call('POST', `/v1/rewards/${reward.id}/redeem`, { token: kid.token });
  await call('POST', `/v1/redemptions/${red.body.redemptionId}/deliver`, { token: dad.token });
  await legacyChildPhoto(fam, kid);
  await call('PUT', '/v1/me/avatar', { token: dad.token, raw: new Uint8Array([4, 5, 6]), contentType: 'image/png' });
  await call('POST', '/v1/devices', { token: kid.token, json: { pushToken: `tok-${Date.now()}-${op++}` } });
  return { fam, dad, kid };
}

/** Rows anywhere in the schema that still point at the member. */
async function leftovers(memberId: string): Promise<Record<string, number>> {
  const queries: Record<string, string> = {
    member: 'SELECT COUNT(*) AS n FROM member WHERE id = ?1',
    parent_login: 'SELECT COUNT(*) AS n FROM parent_login WHERE member_id = ?1',
    session: 'SELECT COUNT(*) AS n FROM session WHERE member_id = ?1',
    device: 'SELECT COUNT(*) AS n FROM device WHERE member_id = ?1',
    invite: 'SELECT COUNT(*) AS n FROM invite WHERE member_id = ?1 OR created_by = ?1',
    task: 'SELECT COUNT(*) AS n FROM task WHERE created_by = ?1',
    task_assignee: 'SELECT COUNT(*) AS n FROM task_assignee WHERE member_id = ?1',
    completion: 'SELECT COUNT(*) AS n FROM completion WHERE member_id = ?1 OR reviewed_by = ?1',
    redemption: 'SELECT COUNT(*) AS n FROM redemption WHERE member_id = ?1 OR resolved_by = ?1',
    member_item: 'SELECT COUNT(*) AS n FROM member_item WHERE member_id = ?1',
    points_ledger: 'SELECT COUNT(*) AS n FROM points_ledger WHERE member_id = ?1',
    streak_award: 'SELECT COUNT(*) AS n FROM streak_award WHERE member_id = ?1',
    notification_outbox: 'SELECT COUNT(*) AS n FROM notification_outbox WHERE member_id = ?1',
    password_reset: 'SELECT COUNT(*) AS n FROM password_reset WHERE member_id = ?1',
    rate_limit: "SELECT COUNT(*) AS n FROM rate_limit WHERE key LIKE '%' || ?1",
  };
  const out: Record<string, number> = {};
  for (const [table, sql] of Object.entries(queries)) {
    const n = (await env.DB.prepare(sql).bind(memberId).first<{ n: number }>())!.n;
    if (n > 0) out[table] = n;
  }
  return out;
}

async function avatarPath(token: string): Promise<string> {
  const me = await call('GET', '/v1/me', { token });
  return (me.body.me.avatarUrl as string).replace(/^https?:\/\/[^/]+/, '');
}

describe('deleting a child', () => {
  it('removes every row and the photo, not just access', async () => {
    const { fam, kid } = await busyFamily();
    const photo = await avatarPath(kid.token);
    expect(Object.keys(await leftovers(kid.id))).toEqual(
      expect.arrayContaining(['member', 'session', 'device', 'task_assignee', 'completion', 'redemption', 'points_ledger']),
    );
    expect((await call('DELETE', `/v1/members/${kid.id}`, { token: fam.parentToken })).status).toBe(200);
    expect(await leftovers(kid.id)).toEqual({});
    expect((await call('GET', '/v1/me', { token: kid.token })).status).toBe(401);
    expect((await call('GET', photo)).status).toBe(404);
    // The family carries on.
    expect((await call('GET', '/v1/members', { token: fam.parentToken })).body).toHaveLength(2);
    expect((await call('GET', '/v1/agenda', { token: fam.parentToken })).status).toBe(200);
  });
});

describe('an adult deletes their own account', () => {
  it('needs the current password', async () => {
    const { fam, dad } = await busyFamily();
    const r = await call('POST', '/v1/me/delete', { token: dad.token, json: { currentPassword: 'zle' } });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('wrong_password');
    expect((await call('GET', '/v1/me', { token: dad.token })).status).toBe(200);
    expect((await call('GET', '/v1/members', { token: fam.parentToken })).body).toHaveLength(3);
  });

  it('removes the adult, keeps the family and hands their tasks to the administrator', async () => {
    const { fam, dad, kid } = await busyFamily();
    const photo = await avatarPath(dad.token);
    expect(Object.keys(await leftovers(dad.id))).toEqual(
      expect.arrayContaining(['member', 'parent_login', 'session', 'task', 'completion', 'redemption']),
    );
    const r = await call('POST', '/v1/me/delete', { token: dad.token, json: { currentPassword: 'haslo-taty-123' } });
    expect(r.status).toBe(200);
    expect(await leftovers(dad.id)).toEqual({});
    expect((await call('GET', '/v1/me', { token: dad.token })).status).toBe(401);
    expect((await call('GET', photo)).status).toBe(404);
    expect((await call('POST', '/v1/auth/login', { json: { email: dad.email, password: 'haslo-taty-123' } })).status).toBe(401);
    // The child's points and history stay; the task now belongs to the administrator.
    const task = await env.DB.prepare('SELECT created_by FROM task WHERE family_id = ?').bind(fam.familyId).first<{ created_by: string }>();
    expect(task?.created_by).toBe(fam.parentId);
    expect((await call('GET', '/v1/me', { token: kid.token })).status).toBe(200);
    expect((await call('GET', '/v1/members', { token: fam.parentToken })).body).toHaveLength(2);
  });

  it('the administrator has to delete the whole family instead', async () => {
    const fam = await registerFamily();
    const r = await call('POST', '/v1/me/delete', { token: fam.parentToken, json: { currentPassword: PW } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('admin_must_delete_family');
  });

  it('is for adults only', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    expect((await call('POST', '/v1/me/delete', { token: kid.token, json: { currentPassword: 'x' } })).status).toBe(403);
    expect((await call('POST', '/v1/family/delete', { token: kid.token, json: { currentPassword: 'x' } })).status).toBe(403);
  });
});

describe('the administrator deletes the family', () => {
  it('only the administrator, with the password', async () => {
    const { fam, dad } = await busyFamily();
    expect((await call('POST', '/v1/family/delete', { token: dad.token, json: { currentPassword: 'haslo-taty-123' } })).status).toBe(403);
    const bad = await call('POST', '/v1/family/delete', { token: fam.parentToken, json: { currentPassword: 'zle' } });
    expect(bad.status).toBe(403);
    expect(bad.body.error).toBe('wrong_password');
    expect((await call('GET', '/v1/me', { token: fam.parentToken })).status).toBe(200);
  });

  it('removes all members, data and files, and leaves other families alone', async () => {
    const { fam, dad, kid } = await busyFamily();
    const other = await busyFamily();
    // A family pack with an uploaded image.
    const pack = await call('POST', '/v1/packs', { token: fam.parentToken, json: { name: 'Nasze', source: 'własne', license: 'private' } });
    expect(pack.status).toBe(201);
    const up = await call(
      'POST',
      `/v1/packs/${pack.body.id}/items?kind=sticker&name=Kot&album=Zwierz%C4%99ta&rarity=common&availability=both`,
      { token: fam.parentToken, raw: new Uint8Array([7, 8, 9]), contentType: 'image/png' },
    );
    expect(up.status).toBe(201);
    await call('PATCH', '/v1/family', { token: fam.parentToken, json: { reminderTime: '17:00' } });
    const before = await env.FILES.list({ prefix: `families/${fam.familyId}/` });
    expect(before.objects.length).toBeGreaterThanOrEqual(3);

    const r = await call('POST', '/v1/family/delete', { token: fam.parentToken, json: { currentPassword: PW } });
    expect(r.status).toBe(200);

    for (const id of [fam.parentId, dad.id, kid.id]) expect(await leftovers(id)).toEqual({});
    for (const token of [fam.parentToken, dad.token, kid.token]) expect((await call('GET', '/v1/me', { token })).status).toBe(401);
    for (const table of ['family WHERE id', 'member WHERE family_id', 'task WHERE family_id', 'reward WHERE family_id', 'pack WHERE family_id', 'invite WHERE family_id', 'pack_setting WHERE family_id']) {
      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} = ?`).bind(fam.familyId).first<{ n: number }>();
      expect(n?.n, table).toBe(0);
    }
    expect((await env.FILES.list({ prefix: `families/${fam.familyId}/` })).objects).toHaveLength(0);
    expect((await call('POST', '/v1/auth/login', { json: { email: fam.email, password: PW } })).status).toBe(401);
    // The e-mail can register again.
    const again = await call('POST', '/v1/auth/register', { json: { familyName: 'Nowa', parentName: 'Mama', email: fam.email, password: PW } });
    expect(again.status).toBe(201);

    // The other family is untouched.
    expect((await call('GET', '/v1/members', { token: other.fam.parentToken })).body).toHaveLength(3);
    expect((await env.FILES.list({ prefix: `families/${other.fam.familyId}/` })).objects.length).toBeGreaterThan(0);
  });
});

describe('public pages', () => {
  it('serves the privacy policy', async () => {
    const r = await call('GET', '/privacy');
    expect(r.status).toBe(200);
    expect(r.body).toContain('Polityka prywatności');
    expect(r.body).toContain('zadania@stillestormstudio.com');
    expect(r.body).toContain('25 listopada 2026');
    expect(r.body).not.toMatch(/<(script|link)\b|src="http/);
  });

  it('explains how to delete an account', async () => {
    const r = await call('GET', '/delete-account');
    expect(r.status).toBe(200);
    expect(r.body).toContain('Usuń konto');
    expect(r.body).toContain('30 dni');
  });
});
