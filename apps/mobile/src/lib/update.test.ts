import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { swapped: false, isParent: false };
const show = vi.fn();
vi.mock('./session.svelte.js', () => ({
  session: {
    get swapped() {
      return state.swapped;
    },
    get isParent() {
      return state.isParent;
    },
  },
}));
vi.mock('./notices.svelte.js', () => ({ notices: { show } }));
vi.mock('./native.js', () => ({ isNative: true, appVersion: async () => ({ name: '1.0.18', code: 19 }) }));
vi.mock('./api.js', () => ({ api: { get: async () => ({ versionCode: 20, versionName: '1.0.19', url: 'u', notes: null, size: 1, sha256: null }) } }));

const { update } = await import('./update.svelte.js');

describe('update notice', () => {
  beforeEach(() => show.mockClear());

  it('is not shown to a child using a parent’s phone, but to the parent afterwards', async () => {
    state.swapped = true;
    await update.check();
    expect(show).not.toHaveBeenCalled();
    state.swapped = false;
    await update.check();
    expect(show).toHaveBeenCalledOnce();
    // A child keeps it until tapped or closed.
    expect(show.mock.calls[0]![3]).toEqual({ sticky: true });
  });
});
