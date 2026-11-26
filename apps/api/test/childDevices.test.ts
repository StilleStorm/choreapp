import { describe, expect, it } from 'vitest';
import { addChild, call, env, registerFamily, type Family } from './helpers.js';

async function devicesOf(fam: Family, childId: string): Promise<number | undefined> {
  const me = await call('GET', '/v1/me', { token: fam.parentToken });
  return me.body.members.find((m: { id: string }) => m.id === childId)?.devices;
}

/** A code for an existing child: another device (addDevice) or a move to a new phone. */
async function childCode(fam: Family, childId: string, addDevice?: boolean) {
  const inv = await call('POST', '/v1/invites', {
    token: fam.parentToken,
    json: { role: 'child', memberId: childId, ...(addDevice === undefined ? {} : { addDevice }) },
  });
  expect(inv.status).toBe(201);
  return inv.body;
}

async function redeem(token: string): Promise<string> {
  const r = await call('POST', '/v1/invites/redeem', { json: { token } });
  expect(r.status).toBe(201);
  return r.body.token;
}

describe('a child without a phone', () => {
  it('is created by an adult right away, with the defaults of an invited child and no device', async () => {
    const fam = await registerFamily();
    const r = await call('POST', '/v1/members', { token: fam.parentToken, json: { name: '  Zosia ' } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ role: 'child', name: 'Zosia', theme: 'kawaii', devices: 0, connected: false, avatarUrl: null });
    const sessions = await env.DB.prepare('SELECT COUNT(*) AS n FROM session WHERE member_id = ?').bind(r.body.id).first<{ n: number }>();
    expect(sessions!.n).toBe(0);
    expect(await devicesOf(fam, r.body.id)).toBe(0);

    // The adult can switch into the new child's account at once; that doesn't make it a device.
    const swap = await call('POST', `/v1/members/${r.body.id}/session`, { token: fam.parentToken });
    expect(swap.status).toBe(201);
    expect((await call('GET', '/v1/agenda', { token: swap.body.token })).status).toBe(200);
    expect(await devicesOf(fam, r.body.id)).toBe(0);
  });

  it('can be added by any adult of the family', async () => {
    const fam = await registerFamily();
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'parent' } });
    const dad = await call('POST', '/v1/invites/redeem', {
      json: { token: inv.body.token, name: 'Tata', email: `tata${Date.now()}@example.com`, password: 'haslo-taty-123' },
    });
    const r = await call('POST', '/v1/members', { token: dad.body.token, json: { name: 'Kuba' } });
    expect(r.status).toBe(201);
    const me = await call('GET', '/v1/me', { token: fam.parentToken });
    expect(me.body.members.map((m: { name: string }) => m.name)).toContain('Kuba');
  });

  it('is refused for children, without a session, with a bad name, and lands only in the caller’s family', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const other = await registerFamily('Nowakowie');
    expect((await call('POST', '/v1/members', { token: kid.token, json: { name: 'Brat' } })).status).toBe(403);
    expect((await call('POST', '/v1/members', { json: { name: 'Brat' } })).status).toBe(401);
    expect((await call('POST', '/v1/members', { token: fam.parentToken, json: { name: '   ' } })).status).toBe(400);
    expect((await call('POST', '/v1/members', { token: fam.parentToken, json: { name: 'x'.repeat(41) } })).status).toBe(400);
    // Extra fields (another family, a role) are ignored: always a child of the caller's own family.
    const r = await call('POST', '/v1/members', {
      token: other.parentToken,
      json: { name: 'Staś', familyId: fam.familyId, role: 'parent' },
    });
    expect(r.status).toBe(201);
    expect(r.body.role).toBe('child');
    const row = await env.DB.prepare('SELECT family_id, role FROM member WHERE id = ?').bind(r.body.id).first<any>();
    expect(row).toEqual({ family_id: other.familyId, role: 'child' });
    const mine = await call('GET', '/v1/me', { token: fam.parentToken });
    expect(mine.body.members.map((m: { name: string }) => m.name)).not.toContain('Staś');
  });

  it('can get a phone later with a code from their profile', async () => {
    const fam = await registerFamily();
    const zosia = await call('POST', '/v1/members', { token: fam.parentToken, json: { name: 'Zosia' } });
    const inv = await childCode(fam, zosia.body.id, true);
    const phone = await redeem(inv.token);
    expect((await call('GET', '/v1/me', { token: phone })).body.me.id).toBe(zosia.body.id);
    expect(await devicesOf(fam, zosia.body.id)).toBe(1);
  });
});

describe('several devices per child', () => {
  it('another device keeps the child’s other devices and swap sessions logged in', async () => {
    const fam = await registerFamily();
    const ola = await addChild(fam);
    const swap = (await call('POST', `/v1/members/${ola.id}/session`, { token: fam.parentToken })).body.token;
    const inv = await childCode(fam, ola.id, true);
    expect(inv.addDevice).toBe(true);
    const info = await call('POST', '/v1/invites/inspect', { json: { token: inv.token } });
    expect(info.body).toMatchObject({ kind: 'reconnect', memberName: 'Ola', addDevice: true });
    const tablet = await redeem(inv.token);
    for (const t of [ola.token, tablet, swap]) expect((await call('GET', '/v1/me', { token: t })).status).toBe(200);
    expect(await devicesOf(fam, ola.id)).toBe(2);
    const third = await redeem((await childCode(fam, ola.id, true)).token);
    expect((await call('GET', '/v1/me', { token: third })).body.me.id).toBe(ola.id);
    expect(await devicesOf(fam, ola.id)).toBe(3);
  });

  it('moving to a new phone logs out every other device and swap session', async () => {
    const fam = await registerFamily();
    const ola = await addChild(fam);
    const tablet = await redeem((await childCode(fam, ola.id, true)).token);
    const swap = (await call('POST', `/v1/members/${ola.id}/session`, { token: fam.parentToken })).body.token;
    await call('POST', '/v1/devices', { token: tablet, json: { pushToken: 'tablet-token-123456' } });
    const inv = await childCode(fam, ola.id, false);
    expect(inv.addDevice).toBe(false);
    const info = await call('POST', '/v1/invites/inspect', { json: { token: inv.token } });
    expect(info.body).toMatchObject({ kind: 'reconnect', addDevice: false });
    const phone = await redeem(inv.token);
    for (const t of [ola.token, tablet, swap]) expect((await call('GET', '/v1/me', { token: t })).status).toBe(401);
    expect((await call('GET', '/v1/me', { token: phone })).body.me.id).toBe(ola.id);
    expect(await devicesOf(fam, ola.id)).toBe(1);
    const d = await env.DB.prepare('SELECT COUNT(*) AS n FROM device WHERE member_id = ?').bind(ola.id).first<{ n: number }>();
    expect(d!.n).toBe(0);
  });

  it('a code without the flag still moves to a new phone (older apps)', async () => {
    const fam = await registerFamily();
    const ola = await addChild(fam);
    await redeem((await childCode(fam, ola.id)).token);
    expect((await call('GET', '/v1/me', { token: ola.token })).status).toBe(401);
  });

  it('pending codes for another device and for a move don’t replace each other', async () => {
    const fam = await registerFamily();
    const ola = await addChild(fam);
    const add = await childCode(fam, ola.id, true);
    const move = await childCode(fam, ola.id, false);
    const tablet = await redeem(add.token);
    expect((await call('GET', '/v1/me', { token: tablet })).status).toBe(200);
    await redeem(move.token);
    expect((await call('GET', '/v1/me', { token: tablet })).status).toBe(401);
  });

  it('refuses the add-device flag for new members and adults', async () => {
    const fam = await registerFamily();
    expect((await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child', addDevice: true } })).status).toBe(400);
    expect(
      (await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'parent', memberId: fam.parentId, addDevice: true } })).status,
    ).toBe(400);
  });
});

describe('device count', () => {
  it('counts only the child’s own live devices, not swap sessions or logged-out ones', async () => {
    const fam = await registerFamily();
    const ola = await addChild(fam);
    expect(await devicesOf(fam, ola.id)).toBe(1);
    const swap = await call('POST', `/v1/members/${ola.id}/session`, { token: fam.parentToken });
    expect(await devicesOf(fam, ola.id)).toBe(1);
    const kind = await env.DB.prepare('SELECT kind FROM session WHERE member_id = ? ORDER BY created_at DESC LIMIT 1').bind(ola.id).first<any>();
    expect(kind.kind).toBe('swap');
    const tablet = await redeem((await childCode(fam, ola.id, true)).token);
    expect(await devicesOf(fam, ola.id)).toBe(2);
    await call('POST', '/v1/auth/logout', { token: tablet });
    await call('POST', '/v1/auth/logout', { token: swap.body.token });
    expect(await devicesOf(fam, ola.id)).toBe(1);
    await call('POST', '/v1/auth/logout', { token: ola.token });
    const me = await call('GET', '/v1/me', { token: fam.parentToken });
    expect(me.body.members.find((m: { id: string }) => m.id === ola.id)).toMatchObject({ devices: 0, connected: false });
  });

  it('is shown to adults only', async () => {
    const fam = await registerFamily();
    const ola = await addChild(fam);
    await addChild(fam, 'Kuba');
    const asChild = await call('GET', '/v1/me', { token: ola.token });
    const kuba = asChild.body.members.find((m: { name: string }) => m.name === 'Kuba');
    expect(kuba.devices).toBeUndefined();
  });
});
