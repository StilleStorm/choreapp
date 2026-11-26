import { describe, expect, it } from 'vitest';
import { addChild, call, env, registerFamily } from './helpers.js';

/** A child without a phone uses an adult's phone: the adult switches into the child's account. */
describe('switching into a child account on an adult phone', () => {
  it('gives an adult a working session for a child of their family', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const r = await call('POST', `/v1/members/${kid.id}/session`, { token: fam.parentToken });
    expect(r.status).toBe(201);
    expect(r.body.me).toMatchObject({ id: kid.id, role: 'child' });
    expect(r.body.family.id).toBe(fam.familyId);
    expect(r.body.token).not.toBe(kid.token);

    const me = await call('GET', '/v1/me', { token: r.body.token });
    expect(me.body.me.id).toBe(kid.id);
    // The child's own phone and the adult's session both stay logged in.
    expect((await call('GET', '/v1/me', { token: kid.token })).status).toBe(200);
    expect((await call('GET', '/v1/me', { token: fam.parentToken })).body.me.id).toBe(fam.parentId);
  });

  it('works for any adult of the family, not only the administrator', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'parent' } });
    const dad = await call('POST', '/v1/invites/redeem', {
      json: { token: inv.body.token, name: 'Tata', email: `tata${Date.now()}@example.com`, password: 'haslo-taty-123' },
    });
    expect(dad.status).toBe(201);
    const r = await call('POST', `/v1/members/${kid.id}/session`, { token: dad.body.token });
    expect(r.status).toBe(201);
  });

  it('refuses a child of another family, adults, siblings (as a child) and unknown ids', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const other = await registerFamily('Nowakowie');
    const otherKid = await addChild(other, 'Staś');

    const cross = await call('POST', `/v1/members/${otherKid.id}/session`, { token: fam.parentToken });
    expect(cross.status).toBe(404);
    expect(cross.body.token).toBeUndefined();
    expect((await call('POST', `/v1/members/${fam.parentId}/session`, { token: fam.parentToken })).status).toBe(404);
    expect((await call('POST', '/v1/members/nie-ma/session', { token: fam.parentToken })).status).toBe(404);
    const sibling = await addChild(fam, 'Kuba');
    expect((await call('POST', `/v1/members/${sibling.id}/session`, { token: kid.token })).status).toBe(403);
    expect((await call('POST', `/v1/members/${kid.id}/session`)).status).toBe(401);
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM session WHERE member_id = ?').bind(otherKid.id).first<{ n: number }>();
    expect(count!.n).toBe(1);
  });

  it('refuses a removed child', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    expect((await call('DELETE', `/v1/members/${kid.id}`, { token: fam.parentToken })).status).toBe(200);
    expect((await call('POST', `/v1/members/${kid.id}/session`, { token: fam.parentToken })).status).toBe(404);
  });

  it('is revocable: switching back logs it out, a new code for the child ends it too', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const a = await call('POST', `/v1/members/${kid.id}/session`, { token: fam.parentToken });
    expect((await call('POST', '/v1/auth/logout', { token: a.body.token, json: {} })).status).toBe(200);
    expect((await call('GET', '/v1/me', { token: a.body.token })).status).toBe(401);
    expect((await call('GET', '/v1/me', { token: fam.parentToken })).status).toBe(200);

    const b = await call('POST', `/v1/members/${kid.id}/session`, { token: fam.parentToken });
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child', memberId: kid.id } });
    expect((await call('POST', '/v1/invites/redeem', { json: { token: inv.body.token } })).status).toBe(201);
    expect((await call('GET', '/v1/me', { token: b.body.token })).status).toBe(401);
  });

  it('gives the child session no access to adult endpoints', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const s = await call('POST', `/v1/members/${kid.id}/session`, { token: fam.parentToken });
    expect((await call('POST', '/v1/invites', { token: s.body.token, json: { role: 'child' } })).status).toBe(403);
    expect((await call('POST', `/v1/members/${kid.id}/session`, { token: s.body.token })).status).toBe(403);
    expect((await call('POST', '/v1/auth/verify-password', { token: s.body.token, json: { currentPassword: 'x' } })).status).toBe(403);
  });
});

describe('checking the adult password to switch back', () => {
  it('accepts the right password and refuses a wrong one', async () => {
    const fam = await registerFamily();
    const ok = await call('POST', '/v1/auth/verify-password', { token: fam.parentToken, json: { currentPassword: 'tajne-haslo-123' } });
    expect(ok.status).toBe(200);
    const bad = await call('POST', '/v1/auth/verify-password', { token: fam.parentToken, json: { currentPassword: 'zle' } });
    expect(bad.status).toBe(403);
    expect(bad.body.error).toBe('wrong_password');
  });

  it('limits guessing', async () => {
    const fam = await registerFamily();
    for (let i = 0; i < 10; i++) {
      await call('POST', '/v1/auth/verify-password', { token: fam.parentToken, json: { currentPassword: `zle-${i}` } });
    }
    const r = await call('POST', '/v1/auth/verify-password', { token: fam.parentToken, json: { currentPassword: 'tajne-haslo-123' } });
    expect(r.status).toBe(429);
  });
});
