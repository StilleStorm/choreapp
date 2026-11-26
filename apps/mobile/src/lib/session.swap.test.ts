import { beforeEach, describe, expect, it, vi } from 'vitest';

const prefs = new Map<string, string>();
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => void prefs.set(key, value),
    remove: async ({ key }: { key: string }) => void prefs.delete(key),
  },
}));
const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('./offline.svelte.js', () => ({ offline: { flush: async () => {} } }));

class ApiFailure extends Error {
  constructor(public status: number) {
    super(String(status));
  }
}
const member = (id: string, role: 'parent' | 'child', name: string) => ({ id, role, name });
const meOf = (m: ReturnType<typeof member>) => ({
  me: m,
  family: { id: 'f1', name: 'Kowalscy' },
  members: [],
  now: Date.now(),
  today: '2026-11-26',
});
const mum = member('p1', 'parent', 'Mama');
const ola = member('c1', 'child', 'Ola');
/** Valid tokens on the "server". */
const servers = new Map<string, ReturnType<typeof meOf>>();
let active: string | null = null;
const request = vi.fn(async (method: string, path: string, opts: { token?: string } = {}) => {
  const token = opts.token ?? active;
  if (path === '/v1/auth/logout') {
    servers.delete(token!);
    return { ok: true };
  }
  const data = token ? servers.get(token) : undefined;
  if (!data) throw new ApiFailure(401);
  return data;
});
vi.mock('./api.js', () => ({
  ApiFailure,
  api: {
    get: async () => {
      const d = servers.get(active!);
      if (!d) throw new ApiFailure(401);
      return d;
    },
    post: async (path: string) => {
      if (path === '/v1/members/c1/session') {
        servers.set('child-swap', meOf(ola));
        return { token: 'child-swap', ...meOf(ola) };
      }
      return {};
    },
  },
  request,
  hasToken: () => !!active,
  setToken: (t: string | null) => (active = t),
  setUnauthorizedHandler: () => {},
}));

const { session } = await import('./session.svelte.js');

describe('a child using a parent phone', () => {
  beforeEach(async () => {
    prefs.clear();
    servers.clear();
    servers.set('adult', meOf(mum));
    prefs.set('homes', JSON.stringify({ list: [{ token: 'adult', familyId: 'f1', familyName: 'Kowalscy', memberId: 'p1', memberName: 'Mama' }], active: 'adult' }));
    await session.init();
    goto.mockClear();
  });

  it('switches into the child and keeps the adult session aside', async () => {
    await session.swapToChild('c1');
    expect(session.swapped).toBe(true);
    expect(session.me?.id).toBe('c1');
    expect(session.isParent).toBe(false);
    expect(session.homes.list.map((h) => h.token)).toEqual(['child-swap']);
    expect(active).toBe('child-swap');
    expect(JSON.parse(prefs.get('swap_parent')!).active).toBe('adult');
    expect(servers.has('adult')).toBe(true); // not logged out
    expect(goto).toHaveBeenCalledWith('/child', { replace: true });
  });

  it('survives an app restart in child mode', async () => {
    await session.swapToChild('c1');
    await session.init();
    expect(session.swapped).toBe(true);
    expect(session.me?.id).toBe('c1');
  });

  it('switches back to the adult and logs the child session out', async () => {
    await session.swapToChild('c1');
    await session.returnToParent();
    expect(session.swapped).toBe(false);
    expect(session.me?.id).toBe('p1');
    expect(active).toBe('adult');
    expect(prefs.has('swap_parent')).toBe(false);
    await vi.waitFor(() => expect(servers.has('child-swap')).toBe(false));
    expect(goto).toHaveBeenLastCalledWith('/parent/settings', { replace: true });
  });

  it('a second swap is refused while already in child mode', async () => {
    await session.swapToChild('c1');
    const before = session.homes;
    await session.swapToChild('c1');
    expect(session.homes).toBe(before);
  });

  it('sends the adult to log in again when their session ended meanwhile', async () => {
    await session.swapToChild('c1');
    servers.delete('adult');
    await session.returnToParent();
    expect(session.swapped).toBe(false);
    expect(session.me).toBeNull();
    expect(session.homes.active).toBeNull();
    expect(goto).toHaveBeenLastCalledWith('/welcome', { replace: true });
  });

  it('drops a stale swap left by a restart in the middle of switching back', async () => {
    prefs.set('swap_parent', prefs.get('homes')!);
    await session.init();
    expect(session.swapped).toBe(false);
    expect(prefs.has('swap_parent')).toBe(false);
  });
});
