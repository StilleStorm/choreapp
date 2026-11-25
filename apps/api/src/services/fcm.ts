/**
 * Firebase Cloud Messaging, HTTP v1 API.
 * Auth: a service-account JWT (RS256, signed with WebCrypto) is exchanged for
 * an OAuth2 access token (~1 h), cached in D1 so signing happens rarely.
 * Docs: https://firebase.google.com/docs/cloud-messaging/send/v1-api
 */
import type { Env } from '../env.js';
import { base64url } from '../lib/crypto.js';
import { first, run } from '../lib/db.js';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CACHE_KEY = 'fcm_access_token';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Same tag replaces an earlier notification on the phone. */
  tag?: string;
}

export type SendResult = 'ok' | 'invalid_token' | 'error';

export function serviceAccount(env: Env): ServiceAccount | null {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  try {
    const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT) as ServiceAccount;
    return sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch {
    console.error('FCM_SERVICE_ACCOUNT is not valid JSON');
    return null;
  }
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function signJwt(sa: ServiceAccount, nowSec: number): Promise<string> {
  const enc = new TextEncoder();
  const header = base64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64url(
    enc.encode(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 })),
  );
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64url(new Uint8Array(sig))}`;
}

async function accessToken(env: Env, sa: ServiceAccount, now: number): Promise<string> {
  const cached = await first<{ value: string; expires_at: number }>(env.DB, 'SELECT value, expires_at FROM kv_cache WHERE key = ?', CACHE_KEY);
  if (cached && cached.expires_at > now + 60_000) return cached.value;
  const assertion = await signJwt(sa, Math.floor(now / 1000));
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
  });
  if (!res.ok) throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  await run(
    env.DB,
    'INSERT INTO kv_cache (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
    CACHE_KEY,
    data.access_token,
    now + data.expires_in * 1000,
  );
  return data.access_token;
}

/** Sends one message to many device tokens; returns the result per token. */
export async function sendPush(env: Env, tokens: string[], msg: PushMessage, now = Date.now()): Promise<Map<string, SendResult>> {
  const results = new Map<string, SendResult>();
  const sa = serviceAccount(env);
  if (!sa || tokens.length === 0) {
    for (const t of tokens) results.set(t, 'error');
    return results;
  }
  const bearer = await accessToken(env, sa, now);
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  await Promise.all(
    tokens.map(async (token) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: msg.title, body: msg.body },
              data: msg.data ?? {},
              android: {
                priority: 'high',
                notification: { channel_id: 'default', ...(msg.tag ? { tag: msg.tag } : {}), icon: 'ic_stat_notify' },
              },
            },
          }),
        });
        if (res.ok) return void results.set(token, 'ok');
        const text = await res.text();
        // Token no longer valid (app uninstalled, data cleared): forget the device.
        const invalid = res.status === 404 || /UNREGISTERED|registration-token-not-registered|INVALID_ARGUMENT.*token/i.test(text);
        results.set(token, invalid ? 'invalid_token' : 'error');
        if (!invalid) console.error('FCM send failed', res.status, text);
      } catch (e) {
        console.error('FCM send error', e);
        results.set(token, 'error');
      }
    }),
  );
  return results;
}
