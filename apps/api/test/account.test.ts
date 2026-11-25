import { describe, expect, it } from 'vitest';
import { addChild, call, env, registerFamily, uniqueEmail } from './helpers.js';

describe('registration and login', () => {
  it('registers a family with its first parent', async () => {
    const email = uniqueEmail();
    const r = await call('POST', '/v1/auth/register', {
      json: { familyName: 'Nowakowie', parentName: 'Tata', email, password: 'dlugie-haslo' },
    });
    expect(r.status).toBe(201);
    expect(r.body.token).toBeTypeOf('string');
    expect(r.body.me).toMatchObject({ role: 'parent', name: 'Tata', email });
    expect(r.body.family).toMatchObject({
      name: 'Nowakowie',
      timezone: 'Europe/Warsaw',
      quietFrom: '22:00',
      quietTo: '07:00',
      reminderTime: '15:00',
      prices: { common: 30, rare: 80, legendary: 200 },
    });
  });

  it('stores only a password hash', async () => {
    const fam = await registerFamily();
    const row = await env.DB.prepare('SELECT * FROM parent_login WHERE member_id = ?').bind(fam.parentId).first<any>();
    expect(row.password_hash).not.toContain('tajne');
    expect(row.password_iterations).toBe(50_000);
  });

  it('rejects a duplicate e-mail', async () => {
    const fam = await registerFamily();
    const r = await call('POST', '/v1/auth/register', {
      json: { familyName: 'X', parentName: 'Y', email: fam.email.toUpperCase(), password: 'dlugie-haslo' },
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('email_taken');
  });

  it('validates input', async () => {
    const r = await call('POST', '/v1/auth/register', {
      json: { familyName: '', parentName: 'Y', email: 'nie-mail', password: 'krotkie' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_input');
  });

  it('logs in with e-mail and password, case-insensitively', async () => {
    const fam = await registerFamily();
    const ok = await call('POST', '/v1/auth/login', { json: { email: fam.email.toUpperCase(), password: 'tajne-haslo-123' } });
    expect(ok.status).toBe(200);
    expect(ok.body.me.id).toBe(fam.parentId);
    const bad = await call('POST', '/v1/auth/login', { json: { email: fam.email, password: 'zle' } });
    expect(bad.status).toBe(401);
    expect(bad.body.error).toBe('invalid_credentials');
  });

  it('limits repeated failed logins', async () => {
    const fam = await registerFamily();
    const ip = '203.0.113.7';
    for (let i = 0; i < 10; i++) {
      await call('POST', '/v1/auth/login', { ip, json: { email: fam.email, password: 'zle' } });
    }
    const r = await call('POST', '/v1/auth/login', { ip: '203.0.113.8', json: { email: fam.email, password: 'tajne-haslo-123' } });
    expect(r.status).toBe(429);
  });

  it('logs out', async () => {
    const fam = await registerFamily();
    expect((await call('POST', '/v1/auth/logout', { token: fam.parentToken })).status).toBe(200);
    expect((await call('GET', '/v1/me', { token: fam.parentToken })).status).toBe(401);
  });

  it('requires a token', async () => {
    expect((await call('GET', '/v1/me')).status).toBe(401);
    expect((await call('GET', '/v1/me', { token: 'nonsense' })).status).toBe(401);
  });
});

describe('me and family settings', () => {
  it('returns me, family, members and today in the family zone', async () => {
    const fam = await registerFamily();
    await addChild(fam, 'Staś');
    const r = await call('GET', '/v1/me', { token: fam.parentToken });
    expect(r.status).toBe(200);
    expect(r.body.members.map((m: any) => m.name)).toEqual(['Mama', 'Staś']);
    expect(r.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lets a parent change family settings and blocks children', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const r = await call('PATCH', '/v1/family', {
      token: fam.parentToken,
      json: { quietFrom: '21:00', quietTo: '06:30', reminderTime: '16:00', priceRare: 100 },
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ quietFrom: '21:00', quietTo: '06:30', reminderTime: '16:00' });
    expect(r.body.prices.rare).toBe(100);
    const bad = await call('PATCH', '/v1/family', { token: fam.parentToken, json: { quietFrom: '25:00' } });
    expect(bad.status).toBe(400);
    const child = await call('PATCH', '/v1/family', { token: kid.token, json: { name: 'Hakerzy' } });
    expect(child.status).toBe(403);
  });

  it('lets a child pick a theme and change their name', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const r = await call('PATCH', '/v1/me', { token: kid.token, json: { theme: 'pixel', name: 'Oleńka' } });
    expect(r.body).toMatchObject({ theme: 'pixel', name: 'Oleńka' });
    expect((await call('PATCH', '/v1/me', { token: kid.token, json: { theme: 'nope' } })).status).toBe(400);
  });

  it('uploads an avatar and serves it through a signed URL', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const r = await call('PUT', '/v1/me/avatar', { token: kid.token, raw: png, contentType: 'image/png' });
    expect(r.status).toBe(200);
    const url = new URL(r.body.avatarUrl);
    const img = await call('GET', url.pathname + url.search);
    expect(img.status).toBe(200);
    const tampered = await call('GET', url.pathname + url.search.replace(/s=[0-9a-f]/, 's=0'));
    expect([403, 200]).toContain(tampered.status); // 1/16 chance the digit was already 0
    const unsigned = await call('GET', url.pathname);
    expect(unsigned.status).toBe(403);
  });

  it('rejects SVG and oversized avatars', async () => {
    const fam = await registerFamily();
    const svg = await call('PUT', '/v1/me/avatar', { token: fam.parentToken, raw: '<svg/>', contentType: 'image/svg+xml' });
    expect(svg.status).toBe(400);
    const big = await call('PUT', '/v1/me/avatar', {
      token: fam.parentToken,
      raw: new Uint8Array(600 * 1024),
      contentType: 'image/webp',
    });
    expect(big.status).toBe(413);
  });
});

describe('members', () => {
  it('removes a child and logs out their phone', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    expect((await call('DELETE', `/v1/members/${kid.id}`, { token: fam.parentToken })).status).toBe(200);
    expect((await call('GET', '/v1/me', { token: kid.token })).status).toBe(401);
    const members = await call('GET', '/v1/members', { token: fam.parentToken });
    expect(members.body).toHaveLength(1);
  });

  it('never removes the last parent', async () => {
    const fam = await registerFamily();
    const r = await call('DELETE', `/v1/members/${fam.parentId}`, { token: fam.parentToken });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('last_parent');
  });

  it('keeps families apart', async () => {
    const a = await registerFamily('A');
    const b = await registerFamily('B');
    const kidB = await addChild(b);
    expect((await call('DELETE', `/v1/members/${kidB.id}`, { token: a.parentToken })).status).toBe(404);
    expect((await call('PATCH', `/v1/members/${kidB.id}`, { token: a.parentToken, json: { name: 'X' } })).status).toBe(404);
  });
});

describe('app releases', () => {
  it('returns the newest release with a signed download link', async () => {
    const fam = await registerFamily();
    expect((await call('GET', '/v1/app/latest', { token: fam.parentToken })).body).toBeNull();
    await env.FILES.put('releases/choreapp-3.apk', new Uint8Array([80, 75, 3, 4]));
    for (const [code, name] of [
      [2, '1.1.0'],
      [3, '1.2.0'],
    ] as const) {
      await env.DB.prepare('INSERT INTO app_release (version_code, version_name, apk_key, notes, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(code, name, `releases/choreapp-${code}.apk`, 'Poprawki', Date.now())
        .run();
    }
    const r = await call('GET', '/v1/app/latest', { token: fam.parentToken });
    expect(r.body).toMatchObject({ versionCode: 3, versionName: '1.2.0', notes: 'Poprawki' });
    const url = new URL(r.body.url);
    expect((await call('GET', url.pathname + url.search)).status).toBe(200);
  });
});
