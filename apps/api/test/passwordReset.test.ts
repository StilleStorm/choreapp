import { beforeEach, describe, expect, it } from 'vitest';
import { addChild, call, emailControl, env, registerFamily, sentEmails, uniqueEmail } from './helpers.js';

function lastCode(): string {
  const text = sentEmails.at(-1)!.text!;
  return text.match(/(\d{3}) (\d{3})/)!.slice(1).join('');
}

function wrongCode(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

describe('forgotten password by e-mail', () => {
  beforeEach(() => {
    sentEmails.length = 0;
    emailControl.fail = false;
  });

  it('answers the same for an unknown e-mail and sends nothing', async () => {
    const r = await call('POST', '/v1/auth/forgot', { json: { email: uniqueEmail() } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(sentEmails).toHaveLength(0);
  });

  it('e-mails a 6-digit code to a known adult and stores only its hash', async () => {
    const fam = await registerFamily();
    const r = await call('POST', '/v1/auth/forgot', { json: { email: fam.email.toUpperCase() } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(sentEmails).toHaveLength(1);
    const m = sentEmails[0]!;
    expect(m.from).toEqual({ email: 'noreply@stillestormstudio.com', name: 'Zadania' });
    expect(m.replyTo).toBe('hello@stillestormstudio.com');
    expect(m.subject).toBe('[Zadania] Kod do zmiany hasła');
    expect(m.to).toBe(fam.email);
    expect(m.text).toContain('aplikacji Zadania');
    expect(m.html).toContain('Twój kod');
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    const row = await env.DB.prepare('SELECT * FROM password_reset WHERE member_id = ?').bind(fam.parentId).first<any>();
    expect(row.code_hash).not.toBe(code);
    expect(row.expires_at - row.created_at).toBe(15 * 60_000);
  });

  it('still answers 200 when sending fails', async () => {
    const fam = await registerFamily();
    emailControl.fail = true;
    const r = await call('POST', '/v1/auth/forgot', { json: { email: fam.email } });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
  });

  it('resets the password, logs out old phones and returns a session', async () => {
    const fam = await registerFamily();
    await call('POST', '/v1/auth/forgot', { json: { email: fam.email } });
    const r = await call('POST', '/v1/auth/reset', { json: { email: fam.email, code: lastCode(), newPassword: 'nowe-haslo-456' } });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTypeOf('string');
    expect(r.body.me.id).toBe(fam.parentId);
    expect(r.body.family.id).toBe(fam.familyId);
    expect((await call('GET', '/v1/me', { token: fam.parentToken })).status).toBe(401);
    expect((await call('GET', '/v1/me', { token: r.body.token })).status).toBe(200);
    expect((await call('POST', '/v1/auth/login', { json: { email: fam.email, password: 'tajne-haslo-123' } })).status).toBe(401);
    expect((await call('POST', '/v1/auth/login', { json: { email: fam.email, password: 'nowe-haslo-456' } })).status).toBe(200);
  });

  it('rejects a wrong code and burns the code after 5 wrong tries', async () => {
    const fam = await registerFamily();
    await call('POST', '/v1/auth/forgot', { json: { email: fam.email } });
    const code = lastCode();
    const bad = await call('POST', '/v1/auth/reset', { json: { email: fam.email, code: wrongCode(code), newPassword: 'nowe-haslo-456' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('reset_code_invalid');
    for (let i = 0; i < 4; i++) {
      await call('POST', '/v1/auth/reset', { json: { email: fam.email, code: wrongCode(code), newPassword: 'nowe-haslo-456' } });
    }
    const late = await call('POST', '/v1/auth/reset', { json: { email: fam.email, code, newPassword: 'nowe-haslo-456' } });
    expect(late.status).toBe(400);
    expect(late.body.error).toBe('reset_code_invalid');
  });

  it('rejects an expired code', async () => {
    const fam = await registerFamily();
    await call('POST', '/v1/auth/forgot', { json: { email: fam.email } });
    await env.DB.prepare('UPDATE password_reset SET expires_at = ? WHERE member_id = ?').bind(Date.now() - 1, fam.parentId).run();
    const r = await call('POST', '/v1/auth/reset', { json: { email: fam.email, code: lastCode(), newPassword: 'nowe-haslo-456' } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('reset_code_invalid');
  });

  it('uses a code only once, and a new request replaces the old code', async () => {
    const fam = await registerFamily();
    await call('POST', '/v1/auth/forgot', { json: { email: fam.email } });
    const first = lastCode();
    await call('POST', '/v1/auth/forgot', { json: { email: fam.email } });
    const second = lastCode();
    if (first !== second) {
      const old = await call('POST', '/v1/auth/reset', { json: { email: fam.email, code: first, newPassword: 'nowe-haslo-456' } });
      expect(old.status).toBe(400);
    }
    const ok = await call('POST', '/v1/auth/reset', { json: { email: fam.email, code: second, newPassword: 'nowe-haslo-456' } });
    expect(ok.status).toBe(200);
    const again = await call('POST', '/v1/auth/reset', { json: { email: fam.email, code: second, newPassword: 'inne-haslo-789' } });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('reset_code_invalid');
  });

  it('validates the new password length', async () => {
    const fam = await registerFamily();
    await call('POST', '/v1/auth/forgot', { json: { email: fam.email } });
    const r = await call('POST', '/v1/auth/reset', { json: { email: fam.email, code: lastCode(), newPassword: 'krotkie' } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_input');
  });

  it('limits requests per e-mail and per IP', async () => {
    const fam = await registerFamily();
    for (let i = 0; i < 3; i++) expect((await call('POST', '/v1/auth/forgot', { json: { email: fam.email } })).status).toBe(200);
    const limited = await call('POST', '/v1/auth/forgot', { json: { email: fam.email } });
    expect(limited.status).toBe(429);
    expect(sentEmails).toHaveLength(3);

    const ip = '198.51.100.23';
    for (let i = 0; i < 10; i++) expect((await call('POST', '/v1/auth/forgot', { ip, json: { email: uniqueEmail() } })).status).toBe(200);
    expect((await call('POST', '/v1/auth/forgot', { ip, json: { email: uniqueEmail() } })).status).toBe(429);
  });

  it('limits wrong reset codes per IP', async () => {
    const ip = '198.51.100.77';
    for (let i = 0; i < 10; i++) {
      const r = await call('POST', '/v1/auth/reset', { ip, json: { email: uniqueEmail(), code: '123456', newPassword: 'nowe-haslo-456' } });
      expect(r.status).toBe(400);
    }
    const r = await call('POST', '/v1/auth/reset', { ip, json: { email: uniqueEmail(), code: '123456', newPassword: 'nowe-haslo-456' } });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('too_many_attempts');
  });

  it('cannot target a child: children have no e-mail login', async () => {
    const fam = await registerFamily();
    const child = await addChild(fam);
    const login = await env.DB.prepare('SELECT 1 FROM parent_login WHERE member_id = ?').bind(child.id).first();
    expect(login).toBeNull();
    // Even a crafted reset row for a child cannot be redeemed through any e-mail.
    await call('POST', '/v1/auth/forgot', { json: { email: uniqueEmail() } });
    expect(sentEmails).toHaveLength(0);
    const r = await call('POST', '/v1/auth/reset', { json: { email: fam.email, code: '123456', newPassword: 'nowe-haslo-456' } });
    expect(r.status).toBe(400);
    expect((await call('GET', '/v1/me', { token: child.token })).status).toBe(200);
  });
});
