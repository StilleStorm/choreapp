/** Registration, login, the current member, family settings and members. */
import { DEFAULT_TIME_ZONE, localDateAt } from '@choreapp/core';
import {
  appearanceBody,
  loginBody,
  registerBody,
  registerDeviceBody,
  updateFamilyBody,
  updateMeBody,
  updateMemberBody,
  type MeDto,
  type SessionDto,
} from '@choreapp/shared';
import { Hono } from 'hono';
import type { AppBindings, Env } from '../env.js';
import { clientIp, createSession, requireParent, revokeMemberSessions } from '../lib/auth.js';
import { PASSWORD_ITERATIONS, hashPassword, newId, verifyPassword } from '../lib/crypto.js';
import { first, hit, isLimited, isUniqueViolation, run } from '../lib/db.js';
import { IMAGE_TYPES, MAX_AVATAR_BYTES } from '../lib/files.js';
import { ApiError, badRequest, body, conflict, forbidden, notFound } from '../lib/http.js';
import { familyDto, loadFamily, loadMember, loadMembers, memberDto } from '../lib/rows.js';

const FAIL_WINDOW = 15 * 60_000;

export async function sessionResponse(env: Env, origin: string, memberId: string, token: string): Promise<SessionDto> {
  const m = (await loadMember(env, memberId))!;
  const f = await loadFamily(env, m.family_id);
  return { token, me: await memberDto(env, origin, m, true), family: familyDto(f) };
}

export const publicAccount = new Hono<AppBindings>()
  .post('/auth/register', async (c) => {
    const b = await body(c, registerBody);
    if (!(await hit(c.env.DB, `register:${clientIp(c.req.raw)}`, 10, 60 * 60_000))) {
      throw new ApiError(429, 'too_many_attempts');
    }
    const now = Date.now();
    const familyId = newId();
    const memberId = newId();
    const pw = await hashPassword(b.password);
    try {
      await c.env.DB.batch([
        c.env.DB.prepare('INSERT INTO family (id, name, timezone, created_at) VALUES (?, ?, ?, ?)').bind(
          familyId,
          b.familyName,
          b.timezone ?? DEFAULT_TIME_ZONE,
          now,
        ),
        c.env.DB.prepare(
          "INSERT INTO member (id, family_id, role, name, theme, created_at) VALUES (?, ?, 'parent', ?, 'minimal', ?)",
        ).bind(memberId, familyId, b.parentName, now),
        c.env.DB.prepare(
          'INSERT INTO parent_login (member_id, email, password_hash, password_salt, password_iterations) VALUES (?, ?, ?, ?, ?)',
        ).bind(memberId, b.email, pw.hash, pw.salt, pw.iterations),
      ]);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('email_taken');
      throw e;
    }
    const { token } = await createSession(c.env.DB, memberId, now);
    return c.json(await sessionResponse(c.env, new URL(c.req.url).origin, memberId, token), 201);
  })

  .post('/auth/login', async (c) => {
    const b = await body(c, loginBody);
    const ipKey = `login-ip:${clientIp(c.req.raw)}`;
    const emailKey = `login-email:${b.email}`;
    if ((await isLimited(c.env.DB, ipKey, 20, FAIL_WINDOW)) || (await isLimited(c.env.DB, emailKey, 10, FAIL_WINDOW))) {
      throw new ApiError(429, 'too_many_attempts');
    }
    const login = await first<{ member_id: string; password_hash: string; password_salt: string; password_iterations: number }>(
      c.env.DB,
      `SELECT pl.* FROM parent_login pl JOIN member m ON m.id = pl.member_id
        WHERE pl.email = ? AND m.removed_at IS NULL`,
      b.email,
    );
    const ok =
      login &&
      (await verifyPassword(b.password, {
        hash: login.password_hash,
        salt: login.password_salt,
        iterations: login.password_iterations,
      }));
    if (!login || !ok) {
      await hit(c.env.DB, ipKey, 1000, FAIL_WINDOW);
      await hit(c.env.DB, emailKey, 1000, FAIL_WINDOW);
      throw new ApiError(401, 'invalid_credentials');
    }
    if (login.password_iterations < PASSWORD_ITERATIONS) {
      const pw = await hashPassword(b.password);
      await run(
        c.env.DB,
        'UPDATE parent_login SET password_hash = ?, password_salt = ?, password_iterations = ? WHERE member_id = ?',
        pw.hash,
        pw.salt,
        pw.iterations,
        login.member_id,
      );
    }
    const { token } = await createSession(c.env.DB, login.member_id);
    return c.json(await sessionResponse(c.env, new URL(c.req.url).origin, login.member_id, token));
  });

export const account = new Hono<AppBindings>()
  .post('/auth/logout', async (c) => {
    const { sessionId } = c.get('auth');
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE session SET revoked_at = ? WHERE id = ?').bind(Date.now(), sessionId),
      c.env.DB.prepare('DELETE FROM device WHERE session_id = ?').bind(sessionId),
    ]);
    return c.json({ ok: true });
  })

  .get('/me', async (c) => {
    const { memberId, familyId } = c.get('auth');
    const origin = new URL(c.req.url).origin;
    const [me, family, members] = await Promise.all([
      loadMember(c.env, memberId),
      loadFamily(c.env, familyId),
      loadMembers(c.env, familyId),
    ]);
    const now = Date.now();
    const isParent = me!.role === 'parent';
    const dto: MeDto = {
      me: await memberDto(c.env, origin, me!, true),
      family: familyDto(family),
      members: await Promise.all(members.map((m) => memberDto(c.env, origin, m, isParent))),
      now,
      today: localDateAt(now, family.timezone),
    };
    return c.json(dto);
  })

  .patch('/me', async (c) => {
    const b = await body(c, updateMeBody);
    const { memberId } = c.get('auth');
    if (b.name !== undefined) await run(c.env.DB, 'UPDATE member SET name = ? WHERE id = ?', b.name, memberId);
    if (b.theme !== undefined) await run(c.env.DB, 'UPDATE member SET theme = ? WHERE id = ?', b.theme, memberId);
    return c.json(await memberDto(c.env, new URL(c.req.url).origin, (await loadMember(c.env, memberId))!, true));
  })

  /** Raw image body; the app resizes to 256 px WebP before upload. */
  .put('/me/avatar', async (c) => {
    const { memberId, familyId } = c.get('auth');
    const type = (c.req.header('Content-Type') ?? '').split(';')[0]!.trim();
    const ext = IMAGE_TYPES[type];
    if (!ext || ext === 'svg') throw badRequest('unsupported_image_type');
    const data = await c.req.arrayBuffer();
    if (data.byteLength === 0) throw badRequest('empty_image');
    if (data.byteLength > MAX_AVATAR_BYTES) throw new ApiError(413, 'image_too_large');
    const key = `families/${familyId}/avatars/${memberId}-${Date.now()}.${ext}`;
    await c.env.FILES.put(key, data, { httpMetadata: { contentType: type } });
    const old = await first<{ avatar_key: string | null }>(c.env.DB, 'SELECT avatar_key FROM member WHERE id = ?', memberId);
    await run(c.env.DB, 'UPDATE member SET avatar_key = ?, avatar_item_id = NULL WHERE id = ?', key, memberId);
    if (old?.avatar_key) await c.env.FILES.delete(old.avatar_key);
    return c.json(await memberDto(c.env, new URL(c.req.url).origin, (await loadMember(c.env, memberId))!, true));
  })

  /** Pick an owned avatar / frame item (or null to go back to the photo / no frame). */
  .put('/me/appearance', async (c) => {
    const b = await body(c, appearanceBody);
    const { memberId } = c.get('auth');
    for (const [itemId, kind] of [
      [b.avatarItemId, 'avatar'],
      [b.frameItemId, 'frame'],
    ] as const) {
      if (!itemId) continue;
      const owned = await first(
        c.env.DB,
        `SELECT 1 FROM member_item mi JOIN item i ON i.id = mi.item_id
          WHERE mi.member_id = ? AND mi.item_id = ? AND i.kind = ?`,
        memberId,
        itemId,
        kind,
      );
      if (!owned) throw forbidden('item_not_owned');
    }
    await run(
      c.env.DB,
      'UPDATE member SET avatar_item_id = ?, frame_item_id = ? WHERE id = ?',
      b.avatarItemId,
      b.frameItemId,
      memberId,
    );
    return c.json(await memberDto(c.env, new URL(c.req.url).origin, (await loadMember(c.env, memberId))!, true));
  })

  .post('/devices', async (c) => {
    const b = await body(c, registerDeviceBody);
    const { memberId, sessionId } = c.get('auth');
    const now = Date.now();
    // A token moves with the phone: re-registering re-assigns it.
    await run(
      c.env.DB,
      `INSERT INTO device (id, member_id, session_id, push_token, app_version, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(push_token) DO UPDATE SET member_id = excluded.member_id, session_id = excluded.session_id,
         app_version = excluded.app_version, last_seen_at = excluded.last_seen_at`,
      newId(),
      memberId,
      sessionId,
      b.pushToken,
      b.appVersion ?? null,
      now,
      now,
    );
    return c.json({ ok: true });
  })

  .get('/family', async (c) => c.json(familyDto(await loadFamily(c.env, c.get('auth').familyId))))

  .patch('/family', requireParent, async (c) => {
    const b = await body(c, updateFamilyBody);
    const { familyId } = c.get('auth');
    const columns: [keyof typeof b, string][] = [
      ['name', 'name'],
      ['timezone', 'timezone'],
      ['quietFrom', 'quiet_from'],
      ['quietTo', 'quiet_to'],
      ['reminderTime', 'reminder_time'],
      ['priceCommon', 'price_common'],
      ['priceRare', 'price_rare'],
      ['priceLegendary', 'price_legendary'],
    ];
    const sets: string[] = [];
    const args: (string | number)[] = [];
    for (const [field, column] of columns) {
      if (b[field] !== undefined) {
        sets.push(`${column} = ?`);
        args.push(b[field]);
      }
    }
    if (sets.length > 0) await run(c.env.DB, `UPDATE family SET ${sets.join(', ')} WHERE id = ?`, ...args, familyId);
    return c.json(familyDto(await loadFamily(c.env, familyId)));
  })

  .get('/members', async (c) => {
    const { familyId, role } = c.get('auth');
    const origin = new URL(c.req.url).origin;
    const members = await loadMembers(c.env, familyId);
    return c.json(await Promise.all(members.map((m) => memberDto(c.env, origin, m, role === 'parent'))));
  })

  .patch('/members/:id', requireParent, async (c) => {
    const b = await body(c, updateMemberBody);
    const m = await loadMember(c.env, c.req.param('id'));
    if (!m || m.family_id !== c.get('auth').familyId || m.removed_at) throw notFound();
    if (b.name !== undefined) await run(c.env.DB, 'UPDATE member SET name = ? WHERE id = ?', b.name, m.id);
    return c.json(await memberDto(c.env, new URL(c.req.url).origin, (await loadMember(c.env, m.id))!, true));
  })

  /** Removes a member from the family. History stays; their phones are logged out. */
  .delete('/members/:id', requireParent, async (c) => {
    const { familyId } = c.get('auth');
    const m = await loadMember(c.env, c.req.param('id'));
    if (!m || m.family_id !== familyId || m.removed_at) throw notFound();
    if (m.role === 'parent') {
      const parents = await first<{ n: number }>(
        c.env.DB,
        "SELECT COUNT(*) AS n FROM member WHERE family_id = ? AND role = 'parent' AND removed_at IS NULL",
        familyId,
      );
      if ((parents?.n ?? 0) <= 1) throw conflict('last_parent');
    }
    const now = Date.now();
    await revokeMemberSessions(c.env.DB, m.id, now);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE member SET removed_at = ? WHERE id = ?').bind(now, m.id),
      // Free the e-mail so the person could be invited again later.
      c.env.DB.prepare('DELETE FROM parent_login WHERE member_id = ?').bind(m.id),
    ]);
    return c.json({ ok: true });
  });
