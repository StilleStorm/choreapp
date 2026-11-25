const enc = new TextEncoder();

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newId(): string {
  return crypto.randomUUID();
}

/** 256-bit random bearer / QR token. */
export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Uniform 6-digit code (rejection sampling, no modulo bias). */
export function sixDigitCode(): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(2 ** 32 / 1_000_000) * 1_000_000;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return String(buf[0]! % 1_000_000).padStart(6, '0');
  }
}

export async function sha256Hex(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Passwords: PBKDF2-SHA256 from WebCrypto. The iteration count is stored per
// login, so it can be raised later and old hashes upgrade on next login.
// 50k iterations take ~6 ms, inside the Workers Free CPU budget.
// ---------------------------------------------------------------------------

export const PASSWORD_ITERATIONS = 50_000;

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toHex(bits);
}

export async function hashPassword(password: string, iterations = PASSWORD_ITERATIONS): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await pbkdf2(password, salt, iterations), salt: toHex(salt), iterations };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const hash = await pbkdf2(password, fromHex(stored.salt), stored.iterations);
  return timingSafeEqual(hash, stored.hash);
}

// ---------------------------------------------------------------------------
// HMAC signatures for file URLs
// ---------------------------------------------------------------------------

const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let k = hmacKeys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(secret, k);
  }
  return k;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message));
  return toHex(sig).slice(0, 32);
}
