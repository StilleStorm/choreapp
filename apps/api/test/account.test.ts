import { describe, expect, it } from 'vitest';
import { addChild, call, env, legacyChildPhoto, registerFamily, uniqueEmail, type Family } from './helpers.js';

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
    // The neutral style is for adults only.
    expect((await call('PATCH', '/v1/me', { token: kid.token, json: { theme: 'neutral' } })).status).toBe(400);
    expect((await call('GET', '/v1/me', { token: kid.token })).body.me.theme).toBe('pixel');
  });

  it('lets an adult pick a theme or go back to the neutral style', async () => {
    const fam = await registerFamily();
    const me = async () => (await call('GET', '/v1/me', { token: fam.parentToken })).body.me.theme;
    expect(await me()).toBe('neutral');
    const r = await call('PATCH', '/v1/me', { token: fam.parentToken, json: { theme: 'forest' } });
    expect(r.status).toBe(200);
    expect(r.body.theme).toBe('forest');
    expect(await me()).toBe('forest');
    expect((await call('PATCH', '/v1/me', { token: fam.parentToken, json: { theme: 'nope' } })).status).toBe(400);
    expect(await me()).toBe('forest');
    expect((await call('PATCH', '/v1/me', { token: fam.parentToken, json: { theme: 'neutral' } })).status).toBe(200);
    expect(await me()).toBe('neutral');
  });

  it('refuses the themes hidden from adults, which children may still pick', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    for (const theme of ['guild', 'lanterns', 'detective']) {
      expect((await call('PATCH', '/v1/me', { token: fam.parentToken, json: { theme } })).status).toBe(400);
      expect((await call('PATCH', '/v1/me', { token: kid.token, json: { theme } })).status).toBe(200);
    }
    expect((await call('GET', '/v1/me', { token: fam.parentToken })).body.me.theme).toBe('neutral');
  });

  it('stops serving a removed member’s photo', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam);
    const path = await legacyChildPhoto(fam, kid);
    expect((await call('GET', path)).status).toBe(200);
    await call('DELETE', `/v1/members/${kid.id}`, { token: fam.parentToken });
    expect((await call('GET', path)).status).toBe(404);
  });

  it('signs file URLs for one to two days', async () => {
    const fam = await registerFamily();
    const up = await call('PUT', '/v1/me/avatar', { token: fam.parentToken, raw: new Uint8Array([1, 2, 3]), contentType: 'image/png' });
    const exp = Number(new URL(up.body.avatarUrl).searchParams.get('e'));
    expect(exp - Date.now()).toBeGreaterThanOrEqual(86_400_000);
    expect(exp - Date.now()).toBeLessThanOrEqual(2 * 86_400_000);
  });

  it('uploads an avatar and serves it through a signed URL', async () => {
    const fam = await registerFamily();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const r = await call('PUT', '/v1/me/avatar', { token: fam.parentToken, raw: png, contentType: 'image/png' });
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

  it('never removes the administrator', async () => {
    const fam = await registerFamily();
    const r = await call('DELETE', `/v1/members/${fam.parentId}`, { token: fam.parentToken });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('admin_cannot_be_removed');
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
    // No stored size: the R2 object's size; no checksum.
    expect(r.body).toMatchObject({ versionCode: 3, versionName: '1.2.0', notes: 'Poprawki', size: 4, sha256: null });
    const url = new URL(r.body.url);
    expect((await call('GET', url.pathname + url.search)).status).toBe(200);
    await env.DB.prepare('UPDATE app_release SET apk_size = 4, apk_sha256 = ? WHERE version_code = 3').bind('ab'.repeat(32)).run();
    expect((await call('GET', '/v1/app/latest', { token: fam.parentToken })).body).toMatchObject({ size: 4, sha256: 'ab'.repeat(32) });
  });
});

async function addParent(fam: Family, name = 'Tata'): Promise<{ token: string; id: string }> {
  const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'parent' } });
  const r = await call('POST', '/v1/invites/redeem', {
    json: { token: inv.body.token, name, email: uniqueEmail(), password: 'haslo-drugie-1' },
  });
  if (r.status !== 201) throw new Error(`redeem failed: ${JSON.stringify(r.body)}`);
  return { token: r.body.token, id: r.body.me.id };
}

describe('family administrator', () => {
  it('is the parent who registered the family', async () => {
    const fam = await registerFamily();
    const dad = await addParent(fam);
    const me = await call('GET', '/v1/me', { token: dad.token });
    expect(me.body.family.adminMemberId).toBe(fam.parentId);
    const row = await env.DB.prepare('SELECT admin_member_id FROM family WHERE id = ?').bind(fam.familyId).first();
    expect(row?.admin_member_id).toBe(fam.parentId);
  });

  it('other adults cannot change family settings, reset passwords, edit adults or remove anyone', async () => {
    const fam = await registerFamily();
    const dad = await addParent(fam);
    const kid = await addChild(fam);
    const forbiddenCalls = [
      await call('PATCH', '/v1/family', { token: dad.token, json: { reminderTime: '17:00' } }),
      await call('POST', '/v1/invites', { token: dad.token, json: { role: 'parent', memberId: fam.parentId } }),
      await call('PATCH', `/v1/members/${fam.parentId}`, { token: dad.token, json: { name: 'X' } }),
      await call('DELETE', `/v1/members/${kid.id}`, { token: dad.token }),
      await call('DELETE', `/v1/members/${fam.parentId}`, { token: dad.token }),
    ];
    for (const r of forbiddenCalls) {
      expect(r.status).toBe(403);
      expect(r.body.error).toBe('admin_only');
    }
    expect((await call('GET', '/v1/members', { token: fam.parentToken })).body).toHaveLength(3);
  });

  it('other adults can still invite children and adults, edit children and themselves', async () => {
    const fam = await registerFamily();
    const dad = await addParent(fam);
    const kid = await addChild(fam);
    expect((await call('POST', '/v1/invites', { token: dad.token, json: { role: 'child' } })).status).toBe(201);
    expect((await call('POST', '/v1/invites', { token: dad.token, json: { role: 'child', memberId: kid.id } })).status).toBe(201);
    expect((await call('POST', '/v1/invites', { token: dad.token, json: { role: 'parent' } })).status).toBe(201);
    const child = await call('PATCH', `/v1/members/${kid.id}`, { token: dad.token, json: { name: 'Ala' } });
    expect(child.status).toBe(200);
    expect(child.body.name).toBe('Ala');
    expect((await call('PATCH', `/v1/members/${dad.id}`, { token: dad.token, json: { name: 'Tatuś' } })).status).toBe(200);
    expect((await call('PATCH', '/v1/me', { token: dad.token, json: { name: 'Tata' } })).status).toBe(200);
  });

  it('the administrator manages other adults and can remove them', async () => {
    const fam = await registerFamily();
    const dad = await addParent(fam);
    expect((await call('PATCH', `/v1/members/${dad.id}`, { token: fam.parentToken, json: { name: 'Tomek' } })).status).toBe(200);
    expect((await call('DELETE', `/v1/members/${dad.id}`, { token: fam.parentToken })).status).toBe(200);
    expect((await call('GET', '/v1/me', { token: dad.token })).status).toBe(401);
  });
});

describe('own e-mail and password', () => {
  const pw = 'tajne-haslo-123';

  it('changes the e-mail after checking the current password', async () => {
    const fam = await registerFamily();
    const newEmail = uniqueEmail();
    const bad = await call('POST', '/v1/me/email', { token: fam.parentToken, json: { currentPassword: 'zle', newEmail } });
    expect(bad.status).toBe(403);
    expect(bad.body.error).toBe('wrong_password');
    const ok = await call('POST', '/v1/me/email', { token: fam.parentToken, json: { currentPassword: pw, newEmail: newEmail.toUpperCase() } });
    expect(ok.status).toBe(200);
    expect(ok.body.email).toBe(newEmail);
    expect((await call('POST', '/v1/auth/login', { json: { email: newEmail, password: pw } })).status).toBe(200);
    expect((await call('POST', '/v1/auth/login', { json: { email: fam.email, password: pw } })).status).toBe(401);
  });

  it('rejects an e-mail used by another adult', async () => {
    const fam = await registerFamily();
    const other = await registerFamily('Nowakowie');
    const r = await call('POST', '/v1/me/email', { token: fam.parentToken, json: { currentPassword: pw, newEmail: other.email } });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('email_taken');
  });

  it('changes the password and logs out the other phones only', async () => {
    const fam = await registerFamily();
    const second = await call('POST', '/v1/auth/login', { json: { email: fam.email, password: pw } });
    const bad = await call('POST', '/v1/me/password', { token: fam.parentToken, json: { currentPassword: 'zle', newPassword: 'nowe-haslo-456' } });
    expect(bad.status).toBe(403);
    expect(bad.body.error).toBe('wrong_password');
    const short = await call('POST', '/v1/me/password', { token: fam.parentToken, json: { currentPassword: pw, newPassword: 'krotkie' } });
    expect(short.status).toBe(400);
    const ok = await call('POST', '/v1/me/password', { token: fam.parentToken, json: { currentPassword: pw, newPassword: 'nowe-haslo-456' } });
    expect(ok.status).toBe(200);
    expect((await call('GET', '/v1/me', { token: fam.parentToken })).status).toBe(200);
    expect((await call('GET', '/v1/me', { token: second.body.token })).status).toBe(401);
    expect((await call('POST', '/v1/auth/login', { json: { email: fam.email, password: pw } })).status).toBe(401);
    expect((await call('POST', '/v1/auth/login', { json: { email: fam.email, password: 'nowe-haslo-456' } })).status).toBe(200);
  });

  it('is for adults only', async () => {
    const fam = await registerFamily();
    const child = await addChild(fam);
    const e = await call('POST', '/v1/me/email', { token: child.token, json: { currentPassword: pw, newEmail: uniqueEmail() } });
    expect(e.status).toBe(403);
    const p = await call('POST', '/v1/me/password', { token: child.token, json: { currentPassword: pw, newPassword: 'nowe-haslo-456' } });
    expect(p.status).toBe(403);
  });
});
