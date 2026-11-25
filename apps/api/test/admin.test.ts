import { localDateAt } from '@choreapp/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { addChild, call, env, legacyChildPhoto, registerFamily, uniqueEmail, type Family } from './helpers.js';

const PW = 'tajne-haslo-123';
const DAD_PW = 'haslo-taty-123';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM rate_limit').run();
});

async function addParent(fam: Family): Promise<{ token: string; id: string; email: string }> {
  const email = uniqueEmail();
  const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'parent' } });
  const r = await call('POST', '/v1/invites/redeem', { json: { token: inv.body.token, name: 'Tata', email, password: DAD_PW } });
  if (r.status !== 201) throw new Error(`redeem failed: ${JSON.stringify(r.body)}`);
  return { token: r.body.token, id: r.body.me.id, email };
}

const transfer = (token: string, memberId: string, currentPassword = PW) =>
  call('POST', '/v1/family/admin', { token, json: { memberId, currentPassword } });

describe('handing over the administrator role', () => {
  it('moves the role to another adult of the family', async () => {
    const fam = await registerFamily();
    const dad = await addParent(fam);
    const r = await transfer(fam.parentToken, dad.id);
    expect(r.status).toBe(200);
    expect(r.body.adminMemberId).toBe(dad.id);
    // The new administrator manages the family, the old one no longer does.
    expect((await call('PATCH', '/v1/family', { token: dad.token, json: { reminderTime: '18:00' } })).status).toBe(200);
    expect((await call('PATCH', '/v1/family', { token: fam.parentToken, json: { reminderTime: '19:00' } })).status).toBe(403);
    expect((await transfer(fam.parentToken, fam.parentId)).status).toBe(403);
    // …and can hand it back.
    expect((await transfer(dad.token, fam.parentId, DAD_PW)).body.adminMemberId).toBe(fam.parentId);
  });

  it('needs the administrator and their password', async () => {
    const fam = await registerFamily();
    const dad = await addParent(fam);
    const kid = await addChild(fam);
    const bad = await transfer(fam.parentToken, dad.id, 'zle-haslo');
    expect(bad.status).toBe(403);
    expect(bad.body.error).toBe('wrong_password');
    expect((await transfer(dad.token, dad.id, DAD_PW)).status).toBe(403);
    expect((await transfer(kid.token, kid.id)).status).toBe(403);
    expect((await call('GET', '/v1/family', { token: fam.parentToken })).body.adminMemberId).toBe(fam.parentId);
  });

  it('only to an adult of the same family', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const other = await registerFamily('Nowakowie');
    const otherDad = await addParent(other);
    // A child in two homes is a separate member in each, and never an administrator.
    const kidThere = await addChild(other);

    const child = await transfer(fam.parentToken, kid.id);
    expect(child.status).toBe(400);
    expect(child.body.error).toBe('admin_must_be_adult');
    for (const id of [otherDad.id, other.parentId, kidThere.id, 'nope']) {
      expect((await transfer(fam.parentToken, id)).status).toBe(404);
    }
    const self = await transfer(fam.parentToken, fam.parentId);
    expect(self.status).toBe(409);
    expect((await call('GET', '/v1/family', { token: fam.parentToken })).body.adminMemberId).toBe(fam.parentId);
    expect((await call('GET', '/v1/family', { token: other.parentToken })).body.adminMemberId).toBe(other.parentId);
  });

  it('lets the former administrator delete only their own account', async () => {
    const fam = await registerFamily();
    const dad = await addParent(fam);
    const kid = await addChild(fam);
    const today = localDateAt(Date.now(), 'Europe/Warsaw');
    const task = await call('POST', '/v1/tasks', {
      token: fam.parentToken,
      json: { title: 'Odkurz', icon: 'broom', assignees: [kid.id], startDate: today, recurrence: { kind: 'once' }, points: 5 },
    });
    expect(task.status).toBe(201);
    expect((await call('POST', '/v1/me/delete', { token: fam.parentToken, json: { currentPassword: PW } })).status).toBe(409);

    expect((await transfer(fam.parentToken, dad.id)).status).toBe(200);
    expect((await call('POST', '/v1/me/delete', { token: fam.parentToken, json: { currentPassword: PW } })).status).toBe(200);

    expect((await call('GET', '/v1/me', { token: fam.parentToken })).status).toBe(401);
    const members = (await call('GET', '/v1/members', { token: dad.token })).body as { id: string }[];
    expect(members.map((m) => m.id).sort()).toEqual([dad.id, kid.id].sort());
    const row = await env.DB.prepare('SELECT created_by FROM task WHERE family_id = ?').bind(fam.familyId).first<{ created_by: string }>();
    expect(row?.created_by).toBe(dad.id);
    expect((await call('GET', '/v1/me', { token: kid.token })).status).toBe(200);
  });
});

describe('children use avatars, not photos', () => {
  it('refuses a photo upload from a child', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const r = await call('PUT', '/v1/me/avatar', { token: kid.token, raw: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('child_photo_not_allowed');
    expect((await env.FILES.list({ prefix: `families/${fam.familyId}/avatars/${kid.id}` })).objects).toHaveLength(0);
    expect((await call('GET', '/v1/me', { token: kid.token })).body.me.avatarUrl).toBeNull();
  });

  it('still takes photos from adults', async () => {
    const fam = await registerFamily();
    const r = await call('PUT', '/v1/me/avatar', { token: fam.parentToken, raw: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
    expect(r.status).toBe(200);
    expect(r.body.avatarUrl).toContain('/v1/files/');
  });

  it('migration 0007 clears old child photos and keeps adult photos', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    await legacyChildPhoto(fam, kid);
    await call('PUT', '/v1/me/avatar', { token: fam.parentToken, raw: new Uint8Array([4, 5, 6]), contentType: 'image/png' });

    const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0007_'));
    expect(migration).toBeDefined();
    for (const q of migration!.queries) await env.DB.prepare(q).run();

    expect((await call('GET', '/v1/me', { token: kid.token })).body.me.avatarUrl).toBeNull();
    expect((await call('GET', '/v1/me', { token: fam.parentToken })).body.me.avatarUrl).toContain('/v1/files/');
  });
});
