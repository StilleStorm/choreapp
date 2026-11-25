/** HTTP client for the Worker API. */
import { Preferences } from '@capacitor/preferences';

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8787';

const TOKEN_KEY = 'session_token';

export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export async function loadToken(): Promise<string | null> {
  token = (await Preferences.get({ key: TOKEN_KEY })).value;
  return token;
}

export async function saveToken(t: string | null): Promise<void> {
  token = t;
  if (t) await Preferences.set({ key: TOKEN_KEY, value: t });
  else await Preferences.remove({ key: TOKEN_KEY });
}

export function hasToken(): boolean {
  return !!token;
}

export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

interface RequestOptions {
  json?: unknown;
  raw?: Blob;
  contentType?: string;
  /** Don't trigger a logout on 401 (login form, invite redemption). */
  public?: boolean;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token && !opts.public) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.raw) {
    headers['Content-Type'] = opts.contentType ?? opts.raw.type;
    body = opts.raw;
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body });
  } catch {
    throw new ApiFailure(0, 'network');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; message?: string };
    if (res.status === 401 && !opts.public) onUnauthorized?.();
    throw new ApiFailure(res.status, err.error ?? `http_${res.status}`, err.message);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, json?: unknown, opts: Omit<RequestOptions, 'json'> = {}) =>
    request<T>('POST', path, { ...opts, json: json ?? {} }),
  patch: <T>(path: string, json: unknown) => request<T>('PATCH', path, { json }),
  put: <T>(path: string, json: unknown) => request<T>('PUT', path, { json }),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, blob: Blob) => request<T>('PUT', path, { raw: blob }),
};
