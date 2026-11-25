/**
 * Files live in R2 and are served through signed URLs, so <img> tags work
 * without an Authorization header. Expiry is rounded up to a day boundary, so
 * a URL lives 24-48 hours and stays stable for the phone's image cache that
 * long; the app gets fresh URLs with every API response.
 */
import type { Env } from '../env.js';
import { hmacHex, timingSafeEqual } from './crypto.js';

const DAY = 86_400_000;

export async function signedFileUrl(env: Env, origin: string, key: string, now = Date.now()): Promise<string> {
  // Built-in pack images are public static assets of the Worker.
  if (key.startsWith('builtin/')) return `${origin}/${key}`;
  const exp = Math.ceil((now + DAY) / DAY) * DAY;
  const sig = await hmacHex(env.FILE_SIGNING_KEY, `${key}|${exp}`);
  return `${origin}/v1/files/${encodeURI(key)}?e=${exp}&s=${sig}`;
}

export async function verifyFileSignature(env: Env, key: string, exp: string, sig: string, now = Date.now()): Promise<boolean> {
  const e = Number(exp);
  if (!Number.isFinite(e) || e < now) return false;
  return timingSafeEqual(await hmacHex(env.FILE_SIGNING_KEY, `${key}|${e}`), sig);
}

export const IMAGE_TYPES: Record<string, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
};

export const MAX_AVATAR_BYTES = 512 * 1024;
export const MAX_ITEM_BYTES = 512 * 1024;
