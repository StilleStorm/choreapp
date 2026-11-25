/**
 * Authorized security attack suite (ChoreApp 1.0.6).
 *
 * Each test drives a two-family setup (family A = attacker, family B = victim)
 * and ASSERTS THE SECURE behaviour, so a test FAILS while the vulnerability is
 * open and passes once it is fixed. Findings map to S1..S7 of the static review
 * plus extra probes (X1..).
 *
 * Run: pnpm --filter @choreapp/api test security.attack
 */
import { env as cfEnv } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index.js';
import { addChild, call, env, registerFamily } from './helpers.js';

async function give(memberId: string, amount: number, reason = 'task') {
  await env.DB.prepare('INSERT INTO points_ledger (id, member_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), memberId, amount, reason, Date.now())
    .run();
}

/** A built-in pack (family_id NULL) is shared by every family, so item ids collide across families. */
async function sharedItem(opts: { kind?: string; rarity?: string; price?: number | null } = {}) {
  const packId = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO pack (id, family_id, name, source, license, attribution, active, created_at) VALUES (?, NULL, 'Shared', 'https://example.org', 'CC0-1.0', NULL, 1, ?)",
  )
    .bind(packId, Date.now())
    .run();
  const itemId = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO item (id, pack_id, kind, name, album, rarity, image_key, price, droppable) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(itemId, packId, opts.kind ?? 'sticker', 'Secret', 'Zwierzaki', opts.rarity ?? 'common', `builtin/${itemId}.svg`, opts.price ?? 0, 1)
    .run();
  return { packId, itemId };
}

async function ownItem(memberId: string, itemId: string, how = 'shop') {
  await env.DB.prepare('INSERT INTO member_item (id, member_id, item_id, acquired_at, how, seen_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), memberId, itemId, Date.now(), how, Date.now())
    .run();
}

// Rate-limit counters (including the global one for invite codes) live in the
// shared test D1: start every attack from a clean slate.
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM rate_limit').run();
});

// ---------------------------------------------------------------------------
// S1 — Cross-family balance / ownership read via GET /v1/shop?member=<id>
// ---------------------------------------------------------------------------
describe('S1 cross-family shop read', () => {
  it('a parent of family A cannot read a family B child balance via ?member=', async () => {
    const famA = await registerFamily('A');
    const famB = await registerFamily('B');
    const bChild = await addChild(famB, 'VictimKid');
    await give(bChild.id, 42);

    const r = await call('GET', `/v1/shop?member=${bChild.id}`, { token: famA.parentToken });

    // SECURE: cross-family member must be rejected. VULNERABLE: 200 with B's data.
    expect([403, 404]).toContain(r.status);
    // And in no case should family A learn family B's child balance.
    if (r.status === 200) expect(r.body.balance).not.toBe(42);
  });
});

// ---------------------------------------------------------------------------
// S2 — Cross-family collection read via GET /v1/members/:id/collection
// ---------------------------------------------------------------------------
describe('S2 cross-family collection read', () => {
  it('a parent of family A cannot read a family B child collection', async () => {
    const famA = await registerFamily('A');
    const famB = await registerFamily('B');
    const bChild = await addChild(famB, 'VictimKid');
    const { itemId } = await sharedItem(); // shared built-in item, visible to A's catalog too
    await ownItem(bChild.id, itemId);

    const r = await call('GET', `/v1/members/${bChild.id}/collection`, { token: famA.parentToken });

    // SECURE: reject cross-family member id.
    expect([403, 404]).toContain(r.status);
    // Concrete leak proof: if served, family A sees that B's child owns the item.
    if (r.status === 200) {
      const allItems = [...r.body.albums.flatMap((a: any) => a.items), ...r.body.avatars, ...r.body.frames];
      const leaked = allItems.find((i: any) => i.id === itemId);
      expect(leaked?.owned).not.toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// S3 — Invite brute-force: per-IP limit bypassable by rotating CF-Connecting-IP,
//      no per-invite attempt cap.
// ---------------------------------------------------------------------------
describe('S3 invite code brute force', () => {
  it('rotating the client IP must not grant unlimited guesses against a live invite', async () => {
    const fam = await registerFamily();
    await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child' } });

    // Attacker sends 60 wrong guesses, rotating CF-Connecting-IP on every request.
    let blocked = false;
    for (let i = 0; i < 60; i++) {
      const ip = `203.0.${Math.floor(i / 250)}.${i % 250}`;
      const guess = String(100000 + i);
      const r = await call('POST', '/v1/invites/redeem', { ip, json: { code: guess, name: 'x' } });
      if (r.status === 429) {
        blocked = true;
        break;
      }
    }
    // SECURE: a global (not per-IP-only) cap eventually blocks the attacker.
    // VULNERABLE: every rotated-IP request returns 404, never 429 -> unlimited.
    expect(blocked).toBe(true);
  });

  it('wrong guesses must burn / cap attempts against a single invite (per-invite cap)', async () => {
    const fam = await registerFamily();
    const inv = await call('POST', '/v1/invites', { token: fam.parentToken, json: { role: 'child' } });

    // 20 wrong guesses, each from a fresh IP so the per-IP limiter never trips.
    for (let i = 0; i < 20; i++) {
      await call('POST', '/v1/invites/redeem', { ip: `198.18.${i}.1`, json: { code: String(200000 + i), name: 'x' } });
    }
    // SECURE: the invite is burned after N wrong tries; the real code no longer works.
    // VULNERABLE: no per-invite cap -> the correct code still redeems.
    const r = await call('POST', '/v1/invites/redeem', { ip: '198.18.250.1', json: { code: inv.body.code, name: 'x' } });
    expect(r.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// S4 — HMAC file signature compared with === (not constant-time).
//      Not remotely exploitable without FILE_SIGNING_KEY; timing cannot be
//      asserted deterministically. This test documents the functional check.
// ---------------------------------------------------------------------------
describe('S4 file signature comparison', () => {
  it('a tampered signature is rejected (functional check only; timing not testable here)', async () => {
    const r = await call('GET', '/v1/files/families/x/avatars/none.png?e=9999999999999&s=deadbeefdeadbeefdeadbeefdeadbeef');
    expect(r.status).toBe(403);
    // NOTE: the === comparison is a timing side channel but needs the secret to matter.
  });
});

// ---------------------------------------------------------------------------
// S5 — Account-existence oracle on POST /me/email (authenticated enumeration).
// Decision (docs/decisions.md): the 409 email_taken stays, because the adult
// needs it to fix a typo, but only after the current password is confirmed and
// only a few times per hour, so it can't be used to probe addresses cheaply.
// ---------------------------------------------------------------------------
describe('S5 email enumeration via /me/email', () => {
  it('without the current password the answer does not reveal whether an e-mail is taken', async () => {
    const famB = await registerFamily('B'); // victim adult, email famB.email
    const famA = await registerFamily('A'); // attacker adult

    const r = await call('POST', '/v1/me/email', {
      token: famA.parentToken,
      json: { currentPassword: 'not-my-password', newEmail: famB.email },
    });
    expect(r.status).toBe(403);
    expect(r.body?.error).toBe('wrong_password');
  });

  it('with the password, probing many addresses is rate-limited', async () => {
    const famB = await registerFamily('B');
    const famA = await registerFamily('A');
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await call('POST', '/v1/me/email', {
        token: famA.parentToken,
        json: { currentPassword: 'tajne-haslo-123', newEmail: i === 0 ? famB.email : `probe${i}-${famB.email}` },
      });
      statuses.push(r.status);
    }
    expect(statuses[0]).toBe(409);
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s !== 429).length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// X1 (extends S6) — signed file URLs are not revoked when a member is removed.
// ---------------------------------------------------------------------------
describe('X1 signed URL survives member removal', () => {
  it('a removed child avatar must stop being served', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam, 'Kid');
    const up = await call('PUT', '/v1/me/avatar', { token: kid.token, raw: new Uint8Array([1, 2, 3, 4]), contentType: 'image/png' });
    expect(up.status).toBe(200);
    const url: string = up.body.avatarUrl;
    const path = url.replace(/^https?:\/\/[^/]+/, '');

    expect((await call('GET', path)).status).toBe(200); // works while a member

    // Admin removes the child.
    await call('DELETE', `/v1/members/${kid.id}`, { token: fam.parentToken });

    const after = await call('GET', path);
    // SECURE: removed member's private file should no longer be served.
    // VULNERABLE: still 200 for up to ~2 weeks (signature only covers key|exp).
    expect(after.status).not.toBe(200);
  });
});

// ---------------------------------------------------------------------------
// X2 — SVG pack uploads accepted; served headers must neutralise XSS (S7 check).
// ---------------------------------------------------------------------------
describe('X2 SVG pack upload served safely', () => {
  it('uploaded SVG is served with nosniff + locked-down CSP', async () => {
    const fam = await registerFamily();
    const pack = await call('POST', '/v1/packs', {
      token: fam.parentToken,
      json: { name: 'Custom', source: 'https://ex.org', license: 'CC0-1.0', active: true },
    });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
    const up = await call('POST', `/v1/packs/${pack.body.id}/items?name=S&album=A&rarity=common`, {
      token: fam.parentToken,
      raw: svg,
      contentType: 'image/svg+xml',
    });
    expect(up.status).toBe(201); // SVG is accepted (S7: upload allowed)
    const url: string = up.body.imageUrl;
    const served = await app.request(url, {}, cfEnv as any);
    expect(served.status).toBe(200);
    // These headers are what mitigates stored XSS from a served SVG; assert them.
    expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff');
    const csp = served.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });
});

// ---------------------------------------------------------------------------
// X3 — Points integrity: concurrent reward redemption must not double-spend.
//      Expected to PASS (documents that spend() is atomic — no finding).
// ---------------------------------------------------------------------------
describe('X3 concurrent redemption integrity', () => {
  it('cannot redeem two rewards with only enough points for one', async () => {
    const fam = await registerFamily();
    const kid = await addChild(fam, 'Kid');
    const reward = await call('POST', '/v1/rewards', { token: fam.parentToken, json: { name: 'Ice', icon: '🍦', cost: 10, active: true } });
    await give(kid.id, 10);

    const results = await Promise.all([
      call('POST', `/v1/rewards/${reward.body.id}/redeem`, { token: kid.token }),
      call('POST', `/v1/rewards/${reward.body.id}/redeem`, { token: kid.token }),
    ]);
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(1); // exactly one succeeds; balance never goes negative

    const bal = (await call('GET', '/v1/members/me/points', { token: kid.token })).body.balance;
    expect(bal).toBe(0);
  });
});
