/**
 * Files live in R2 and are served through signed URLs, so <img> tags work
 * without an Authorization header. Expiry is rounded to a week boundary so
 * the URL (and the phone's image cache) stays stable for days.
 */
import type { Env } from '../env.js';
import { hmacHex } from './crypto.js';

const WEEK = 7 * 86_400_000;

export async function signedFileUrl(env: Env, origin: string, key: string, now = Date.now()): Promise<string> {
  // Built-in pack images are public static assets of the Worker.
  if (key.startsWith('builtin/')) return `${origin}/${key}`;
  const exp = Math.ceil((now + WEEK) / WEEK) * WEEK;
  const sig = await hmacHex(env.FILE_SIGNING_KEY, `${key}|${exp}`);
  return `${origin}/v1/files/${encodeURI(key)}?e=${exp}&s=${sig}`;
}

export async function verifyFileSignature(env: Env, key: string, exp: string, sig: string, now = Date.now()): Promise<boolean> {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < now) return false;
  return (await hmacHex(env.FILE_SIGNING_KEY, `${key}|${e}`)) === sig;
}

export const IMAGE_TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
};

export const MAX_AVATAR_BYTES = 512 * 1024;
export const MAX_ITEM_BYTES = 512 * 1024;
