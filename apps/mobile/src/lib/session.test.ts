import { beforeEach, describe, expect, it, vi } from 'vitest';

const prefs = new Map<string, string>();
const set = vi.fn(async ({ key, value }: { key: string; value: string }) => void prefs.set(key, value));
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set,
    remove: async ({ key }: { key: string }) => void prefs.delete(key),
  },
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('./offline.svelte.js', () => ({ offline: { flush: async () => {} } }));

const me = (familyId: string, familyName: string, memberId: string) => ({
  me: { id: memberId, name: 'Ola', role: 'child' },
  family: { id: familyId, name: familyName },
  members: [],
  now: Date.now(),
  today: '2026-11-25',
});
const servers: Record<string, ReturnType<typeof me>> = {
  ta: me('f1', 'Dom mamy', 'm1'),
  tb: me('f2', 'Dom taty', 'm2'),
};
const request = vi.fn(async (_method: string, _path: string, opts: { token?: string } = {}) => servers[opts.token ?? 'ta']);
vi.mock('./api.js', () => ({
  ApiFailure: class extends Error {},
  api: { get: async () => servers.ta, post: async () => ({}) },
  request,
  hasToken: () => true,
  setToken: () => {},
  setUnauthorizedHandler: () => {},
}));

const { session } = await import('./session.svelte.js');

describe('checking the other homes on a child phone', () => {
  beforeEach(async () => {
    prefs.clear();
    prefs.set(
      'homes',
      JSON.stringify({
        list: [
          { token: 'ta', familyId: 'f1', familyName: 'Dom mamy', memberId: 'm1', memberName: 'Ola' },
          { token: 'tb', familyId: 'f2', familyName: 'Dom taty', memberId: 'm2', memberName: 'Ola' },
        ],
        active: 'ta',
      }),
    );
    await session.init();
    await session.checkHomes(); // init starts one too: let it finish
    set.mockClear();
    request.mockClear();
  });

  it('does not save or replace homes when nothing changed (no reactive loop)', async () => {
    const before = session.homes;
    await session.checkHomes();
    await session.checkHomes();
    expect(session.homes).toBe(before);
    expect(set).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(2); // one /me per check, only for the other home
  });

  it('overlapping calls share one round of requests', async () => {
    await Promise.all([session.checkHomes(), session.checkHomes(), session.checkHomes()]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('saves a renamed home once', async () => {
    servers.tb = me('f2', 'Dom taty i Ani', 'm2');
    await session.checkHomes();
    const after = session.homes;
    expect(after.list[1]!.familyName).toBe('Dom taty i Ani');
    await session.checkHomes();
    expect(session.homes).toBe(after);
    expect(set.mock.calls.filter(([p]) => p.key === 'homes')).toHaveLength(1);
  });
});
