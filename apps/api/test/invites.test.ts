import { describe, expect, it } from 'vitest';
import { addChild, call, env, registerFamily, uniqueEmail } from './helpers.js';

describe('child joins with QR or code', () => {
  it('creates an invite with a 6-digit code and a QR payload', async () => {
    const fam = await registerFamily();
    const r = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child' } });
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^\d{6}$/);
    expect(r.body.qr).toBe(`choreapp://join?t=${r.body.token}`);
    expect(r.body.expiresAt - Date.now()).toBeGreaterThan(14 * 60_000);
  });

  it('joins by scanning the QR token, no e-mail or password', async () => {
    const fam = await registerFamily();
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child' } });
    const info = await call('POST', '/v1/invites/inspect', { json: { token: inv.body.token } });
    expect(info.body).toMatchObject({ kind: 'join', role: 'child', familyName: 'Kowalscy' });
    const r = await call('POST', '/v1/invites/redeem', { json: { token: inv.body.token, name: 'Zosia' } });
    expect(r.status).toBe(201);
    expect(r.body.me).toMatchObject({ role: 'child', name: 'Zosia', theme: 'kawaii' });
    expect((await call('GET', '/v1/me', { token: r.body.token })).body.me.name).toBe('Zosia');
  });

  it('joins by typing the code', async () => {
    const fam = await registerFamily();
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child' } });
    const r = await call('POST', '/v1/invites/redeem', { json: { code: inv.body.code, name: 'Kuba' } });
    expect(r.status).toBe(201);
  });

  it('is single use', async () => {
    const fam = await registerFamily();
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child' } });
    await call('POST', '/v1/invites/redeem', { json: { code: inv.body.code, name: 'A' } });
    const again = await call('POST', '/v1/invites/redeem', { json: { code: inv.body.code, name: 'B' } });
    expect(again.status).toBe(404);
    expect(again.body.error).toBe('invite_invalid');
  });

  it('requires a name and does not burn the code when missing', async () => {
    const fam = await registerFamily();
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child' } });
    expect((await call('POST', '/v1/invites/redeem', { json: { code: inv.body.code } })).status).toBe(400);
    expect((await call('POST', '/v1/invites/redeem', { json: { code: inv.body.code, name: 'Ola' } })).status).toBe(201);
  });

  it('expires after 15 minutes', async () => {
    const fam = await registerFamily();
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child' } });
    await env.DB.prepare('UPDATE invite SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, inv.body.id).run();
    expect((await call('POST', '/v1/invites/redeem', { json: { code: inv.body.code, name: 'A' } })).status).toBe(404);
  });

  it('a new code replaces the previous pending one', async () => {
    const fam = await registerFamily();
    const first = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child' } });
    await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child' } });
    expect((await call('POST', '/v1/invites/redeem', { json: { code: first.body.code, name: 'A' } })).status).toBe(404);
    expect((await call('GET', '/v1/invites', { token: fam.parentToken })).body).toHaveLength(1);
  });

  it('blocks guessing after 10 wrong codes from one address', async () => {
    const ip = '198.51.100.23';
    for (let i = 0; i < 10; i++) {
      await call('POST', '/v1/invites/inspect', { ip, json: { code: String(100000 + i) } });
    }
    const fam = await registerFamily();
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child' } });
    const r = await call('POST', '/v1/invites/redeem', { ip, json: { code: inv.body.code, name: 'A' } });
    expect(r.status).toBe(429);
  });

  it('only parents create invites', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    expect((await call('POST', '/v1/invites', { token: kid.token, json: { role: 'child' } })).status).toBe(403);
  });
});

describe("child's new phone", () => {
  it('keeps the profile and logs out the old phone', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam, 'Ola');
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child', memberId: kid.id } });
    const info = await call('POST', '/v1/invites/inspect', { json: { code: inv.body.code } });
    expect(info.body).toMatchObject({ kind: 'reconnect', memberName: 'Ola' });
    const r = await call('POST', '/v1/invites/redeem', { json: { code: inv.body.code } });
    expect(r.status).toBe(201);
    expect(r.body.me.id).toBe(kid.id);
    expect((await call('GET', '/v1/me', { token: kid.token })).status).toBe(401);
    expect((await call('GET', '/v1/me', { token: r.body.token })).status).toBe(200);
  });

  it('rejects a role mismatch', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const r = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'parent', memberId: kid.id } });
    expect(r.status).toBe(400);
  });
});

describe('second parent and password reset', () => {
  it('a second parent joins with e-mail and password', async () => {
    const fam = await registerFamily();
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'parent' } });
    const email = uniqueEmail();
    const noPw = await call('POST', '/v1/invites/redeem', { json: { token: inv.body.token, name: 'Tata' } });
    expect(noPw.status).toBe(400);
    const r = await call('POST', '/v1/invites/redeem', {
      json: { token: inv.body.token, name: 'Tata', email, password: 'haslo-taty-1' },
    });
    expect(r.status).toBe(201);
    expect(r.body.me).toMatchObject({ role: 'parent', theme: 'neutral' });
    const login = await call('POST', '/v1/auth/login', { json: { email, password: 'haslo-taty-1' } });
    expect(login.status).toBe(200);
    const child = await call('POST', '/v1/invites', { token: login.body.token, json: { role: 'child' } });
    expect(child.status).toBe(201);
  });

  it('the administrator can reset another parent’s password', async () => {
    const fam = await registerFamily();
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'parent' } });
    const email = uniqueEmail();
    const dad = await call('POST', '/v1/invites/redeem', {
      json: { token: inv.body.token, name: 'Tata', email, password: 'stare-haslo-1' },
    });
    const reset = await call('POST', '/v1/invites', {
      token: fam.parentToken,
      json: { role: 'parent', memberId: dad.body.me.id },
    });
    const info = await call('POST', '/v1/invites/inspect', { json: { code: reset.body.code } });
    expect(info.body.kind).toBe('reset');
    const r = await call('POST', '/v1/invites/redeem', { json: { code: reset.body.code, password: 'nowe-haslo-1' } });
    expect(r.status).toBe(201);
    expect((await call('GET', '/v1/me', { token: dad.body.token })).status).toBe(401);
    expect((await call('POST', '/v1/auth/login', { json: { email, password: 'stare-haslo-1' } })).status).toBe(401);
    expect((await call('POST', '/v1/auth/login', { json: { email, password: 'nowe-haslo-1' } })).status).toBe(200);
  });
});
