import { localDateAt, zonedToEpoch } from '@choreapp/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index.js';
import type { Env } from '../src/env.js';
import { composeForMember, deliverDue, enqueue } from '../src/services/notify.js';
import { runCron, sendReminders } from '../src/services/cron.js';
import { addChild, call, env, registerFamily } from './helpers.js';

const TZ = 'Europe/Warsaw';
const today = () => localDateAt(Date.now(), TZ);

interface Sent {
  token: string;
  title: string;
  body: string;
}

let sent: Sent[] = [];
let tokenExchanges = 0;
let testEnv: Env;

async function serviceAccountJson(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({ project_id: 'choreapp-test', client_email: 'push@choreapp-test.iam.gserviceaccount.com', private_key: pem });
}

beforeEach(async () => {
  sent = [];
  tokenExchanges = 0;
  testEnv = { ...(env as unknown as Env), FCM_SERVICE_ACCOUNT: await serviceAccountJson() };
  await env.DB.prepare('DELETE FROM kv_cache').run();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'https://oauth2.googleapis.com/token') {
      tokenExchanges++;
      const form = new URLSearchParams(String(init?.body));
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
      expect(form.get('assertion')!.split('.')).toHaveLength(3);
      return Response.json({ access_token: 'ya29.test', expires_in: 3600 });
    }
    if (url.startsWith('https://fcm.googleapis.com/v1/projects/choreapp-test/messages:send')) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer ya29.test');
      const { message } = JSON.parse(String(init?.body));
      if (message.token === 'dead-token-0000000') return new Response('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}', { status: 404 });
      sent.push({ token: message.token, title: message.notification.title, body: message.notification.body });
      return Response.json({ name: 'projects/choreapp-test/messages/1' });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Same as call() but with the FCM-enabled env. */
async function callFcm(method: string, path: string, token: string, json?: unknown) {
  const res = await app.request(
    `http://api.test${path}`,
    { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: json ? JSON.stringify(json) : undefined },
    testEnv,
  );
  return { status: res.status, body: (await res.json()) as any };
}

async function noQuiet(token: string) {
  await call('PATCH', '/v1/family', { token, json: { quietFrom: '00:00', quietTo: '00:00' } });
}

describe('push delivery', () => {
  it('a report notifies every parent phone right away', async () => {
    const fam = await registerFamily();
    await noQuiet(fam.parentToken);
    const ola = await addChild(fam, 'Ola');
    await call('POST', '/v1/devices', { token: fam.parentToken, json: { pushToken: 'parent-phone-token-1' } });
    await callFcm('POST', '/v1/tasks', fam.parentToken, { title: 'Pokój', icon: 'broom', assignees: [ola.id], startDate: today(), recurrence: { kind: 'once' } });
    const item = (await call('GET', '/v1/agenda', { token: ola.token })).body.items[0];
    await callFcm('POST', `/v1/occurrences/${item.occurrenceId}/report`, ola.token, { clientOpId: crypto.randomUUID() });
    expect(sent).toEqual([{ token: 'parent-phone-token-1', title: 'Ola: zrobione!', body: 'Pokój. Sprawdź i zatwierdź.' }]);
  });

  it('new task, approval and rejection notify the child', async () => {
    const fam = await registerFamily();
    await noQuiet(fam.parentToken);
    const ola = await addChild(fam, 'Ola');
    await call('POST', '/v1/devices', { token: ola.token, json: { pushToken: 'ola-phone-token-1' } });
    await callFcm('POST', '/v1/tasks', fam.parentToken, { title: 'Lekcje', icon: 'books', assignees: [ola.id], startDate: today(), recurrence: { kind: 'once' }, points: 20 });
    expect(sent.at(-1)).toMatchObject({ title: 'Nowe zadanie', body: 'Lekcje' });
    const item = (await call('GET', '/v1/agenda', { token: ola.token })).body.items[0];
    const rep = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: crypto.randomUUID() } });
    await callFcm('POST', `/v1/completions/${rep.body.completionId}/reject`, fam.parentToken, { comment: 'Brakuje zadania 3' });
    expect(sent.at(-1)).toMatchObject({ title: 'Do poprawki: Lekcje', body: 'Brakuje zadania 3' });
    const rep2 = await call('POST', `/v1/occurrences/${item.occurrenceId}/report`, { token: ola.token, json: { clientOpId: crypto.randomUUID() } });
    await callFcm('POST', `/v1/completions/${rep2.body.completionId}/approve`, fam.parentToken);
    expect(sent.at(-1)!.title).toBe('Zatwierdzone! +20 pkt');
  });

  it('reuses the access token instead of signing every time', async () => {
    const fam = await registerFamily();
    await noQuiet(fam.parentToken);
    const ola = await addChild(fam, 'Ola');
    await call('POST', '/v1/devices', { token: ola.token, json: { pushToken: 'ola-phone-token-2' } });
    for (let i = 0; i < 3; i++) {
      await callFcm('POST', '/v1/tasks', fam.parentToken, { title: `T${i}`, icon: 'books', assignees: [ola.id], startDate: today(), recurrence: { kind: 'once' } });
    }
    expect(sent).toHaveLength(3);
    expect(tokenExchanges).toBe(1);
  });

  it('forgets devices whose token is no longer valid', async () => {
    const fam = await registerFamily();
    await noQuiet(fam.parentToken);
    const ola = await addChild(fam, 'Ola');
    await call('POST', '/v1/devices', { token: ola.token, json: { pushToken: 'dead-token-0000000' } });
    await callFcm('POST', '/v1/tasks', fam.parentToken, { title: 'X', icon: 'books', assignees: [ola.id], startDate: today(), recurrence: { kind: 'once' } });
    const d = await env.DB.prepare('SELECT COUNT(*) AS n FROM device WHERE member_id = ?').bind(ola.id).first<any>();
    expect(d.n).toBe(0);
  });

  it('one phone in two families gets pushes from both', async () => {
    const mum = await registerFamily('Dom mamy');
    const dad = await registerFamily('Dom taty');
    await noQuiet(mum.parentToken);
    await noQuiet(dad.parentToken);
    const atMum = await addChild(mum, 'Ola');
    const atDad = await addChild(dad, 'Ola');
    await call('POST', '/v1/devices', { token: atMum.token, json: { pushToken: 'ola-two-homes-token' } });
    await call('POST', '/v1/devices', { token: atDad.token, json: { pushToken: 'ola-two-homes-token' } });
    await callFcm('POST', '/v1/tasks', mum.parentToken, { title: 'U mamy', icon: 'books', assignees: [atMum.id], startDate: today(), recurrence: { kind: 'once' } });
    await callFcm('POST', '/v1/tasks', dad.parentToken, { title: 'U taty', icon: 'books', assignees: [atDad.id], startDate: today(), recurrence: { kind: 'once' } });
    expect(sent.map((m) => m.body)).toEqual(['U mamy', 'U taty']);
    expect(sent.every((m) => m.token === 'ola-two-homes-token')).toBe(true);
    // Leaving one home keeps the other one's notifications.
    await call('POST', '/v1/auth/logout', { token: atMum.token });
    const d = await env.DB.prepare('SELECT member_id FROM device WHERE push_token = ?').bind('ola-two-homes-token').all<any>();
    expect(d.results.map((r: any) => r.member_id)).toEqual([atDad.id]);
  });

  it('logging out stops pushes to that phone', async () => {
    const fam = await registerFamily();
    await noQuiet(fam.parentToken);
    const ola = await addChild(fam, 'Ola');
    await call('POST', '/v1/devices', { token: ola.token, json: { pushToken: 'ola-phone-token-3' } });
    await call('POST', '/v1/auth/logout', { token: ola.token });
    const d = await env.DB.prepare('SELECT COUNT(*) AS n FROM device WHERE member_id = ?').bind(ola.id).first<any>();
    expect(d.n).toBe(0);
  });
});

describe('quiet hours', () => {
  it('hold notifications at night and send one digest in the morning', async () => {
    const fam = await registerFamily();
    const ola = await addChild(fam, 'Ola');
    await call('POST', '/v1/devices', { token: ola.token, json: { pushToken: 'ola-night-token-1' } });
    const family = (await env.DB.prepare('SELECT * FROM family WHERE id = ?').bind(fam.familyId).first<any>())!;
    const night = zonedToEpoch('2026-12-01', '23:10', TZ);
    await enqueue(testEnv, family, [ola.id], { type: 'task_new', title: 'Nowe zadanie', body: 'Lekcje' }, night);
    await enqueue(testEnv, family, [ola.id], { type: 'task_new', title: 'Nowe zadanie', body: 'Pokój' }, night + 60_000);
    await enqueue(testEnv, family, [ola.id], { type: 'rejected', title: 'Do poprawki: Pies', body: '…' }, night + 120_000);
    expect(sent).toHaveLength(0);

    // 06:55 is still quiet, 07:00 is not.
    expect(await deliverDue(testEnv, zonedToEpoch('2026-12-02', '06:55', TZ))).toBe(0);
    await deliverDue(testEnv, zonedToEpoch('2026-12-02', '07:00', TZ));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.title).toBe('Masz 3 powiadomienia');
    expect(sent[0]!.body).toBe('Nowe zadanie · Nowe zadanie · Do poprawki: Pies');
    // Nothing is sent twice.
    await deliverDue(testEnv, zonedToEpoch('2026-12-02', '07:05', TZ));
    expect(sent).toHaveLength(1);
  });

  it('uses the family’s own window', async () => {
    const fam = await registerFamily();
    await call('PATCH', '/v1/family', { token: fam.parentToken, json: { quietFrom: '20:00', quietTo: '08:00' } });
    const ola = await addChild(fam, 'Ola');
    await call('POST', '/v1/devices', { token: ola.token, json: { pushToken: 'ola-window-token' } });
    const family = (await env.DB.prepare('SELECT * FROM family WHERE id = ?').bind(fam.familyId).first<any>())!;
    await enqueue(testEnv, family, [ola.id], { type: 'task_new', title: 'A', body: 'a' }, zonedToEpoch('2026-12-01', '21:00', TZ));
    expect(sent).toHaveLength(0);
    await deliverDue(testEnv, zonedToEpoch('2026-12-02', '07:30', TZ));
    expect(sent).toHaveLength(0);
    await deliverDue(testEnv, zonedToEpoch('2026-12-02', '08:00', TZ));
    expect(sent).toHaveLength(1);
  });

  it('switching quiet hours off releases what was held', async () => {
    const fam = await registerFamily();
    const ola = await addChild(fam, 'Ola');
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO notification_outbox (id, member_id, type, title, body, data, created_at, deliver_after) VALUES (?, ?, 'task_new', 'A', 'a', NULL, ?, ?)",
    )
      .bind(crypto.randomUUID(), ola.id, now, now + 8 * 3_600_000)
      .run();
    await noQuiet(fam.parentToken);
    const row = await env.DB.prepare('SELECT deliver_after FROM notification_outbox WHERE member_id = ?').bind(ola.id).first<{ deliver_after: number }>();
    expect(row!.deliver_after).toBeLessThanOrEqual(Date.now());
  });

  it('single on-time notification keeps its own text', () => {
    const msg = composeForMember([
      { id: '1', member_id: 'm', type: 'report', title: 'Ola: zrobione!', body: 'Pokój', data: '{"screen":"approvals"}', created_at: 5, deliver_after: 5 },
    ]);
    expect(msg).toMatchObject({ title: 'Ola: zrobione!', body: 'Pokój', data: { type: 'report', screen: 'approvals' } });
  });
});

describe('daily reminder', () => {
  it('reminds once a day after the reminder time, only with unfinished tasks', async () => {
    const fam = await registerFamily();
    await noQuiet(fam.parentToken);
    await call('PATCH', '/v1/family', { token: fam.parentToken, json: { reminderTime: '00:00' } });
    const ola = await addChild(fam, 'Ola');
    const kuba = await addChild(fam, 'Kuba');
    await call('POST', '/v1/devices', { token: ola.token, json: { pushToken: 'ola-reminder-tok' } });
    await call('POST', '/v1/devices', { token: kuba.token, json: { pushToken: 'kuba-reminder-tok' } });
    for (const t of ['Pokój', 'Lekcje']) {
      await call('POST', '/v1/tasks', { token: fam.parentToken, json: { title: t, icon: 'books', assignees: [ola.id], startDate: today(), recurrence: { kind: 'once' } } });
    }
    const family = (await env.DB.prepare('SELECT * FROM family WHERE id = ?').bind(fam.familyId).first<any>())!;
    const n = await sendReminders(testEnv, family, Date.now());
    expect(n).toBe(1);
    expect(sent).toEqual([{ token: 'ola-reminder-tok', title: 'Zadania na dziś', body: 'Zostały Ci 2 zadania. Dasz radę!' }]);
    expect(await sendReminders(testEnv, family, Date.now() + 5 * 60_000)).toBe(0);
  });

  it('the cron runs end to end', async () => {
    await expect(runCron(testEnv, Date.now())).resolves.toBeUndefined();
  });
});
