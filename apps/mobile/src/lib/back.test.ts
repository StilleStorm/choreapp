import { describe, expect, it, vi } from 'vitest';
import { backNotice, createBackHandler, EXIT_WINDOW_MS } from './back.svelte.js';

function setup(opts: { dialog?: boolean; pack?: boolean } = {}) {
  let t = 1_000_000;
  let dialog = opts.dialog ?? false;
  const deps = {
    now: () => t,
    closeDialog: vi.fn(() => {
      const was = dialog;
      dialog = false;
      return was;
    }),
    packOpen: () => opts.pack ?? false,
    goBack: vi.fn(),
    exit: vi.fn(),
  };
  const back = createBackHandler(deps);
  return { deps, back, advance: (ms: number) => (t += ms) };
}

describe('Android back', () => {
  it('goes back inside the app', () => {
    const { deps, back } = setup();
    back({ canGoBack: true });
    expect(deps.goBack).toHaveBeenCalledOnce();
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it('on a root screen: first press shows the notice, second within the window exits', () => {
    const { deps, back, advance } = setup();
    back({ canGoBack: false });
    expect(backNotice.shown).toBe(true);
    expect(deps.exit).not.toHaveBeenCalled();
    advance(1000);
    back({ canGoBack: false });
    expect(deps.exit).toHaveBeenCalledOnce();
    expect(backNotice.shown).toBe(false);
  });

  it('a second press after the window only shows the notice again', () => {
    const { deps, back, advance } = setup();
    back({ canGoBack: false });
    advance(EXIT_WINDOW_MS + 500);
    back({ canGoBack: false });
    expect(deps.exit).not.toHaveBeenCalled();
    expect(backNotice.shown).toBe(true);
  });

  it('closes an open sheet first, and does nothing during a pack opening', () => {
    const a = setup({ dialog: true });
    a.back({ canGoBack: false });
    expect(a.deps.closeDialog).toHaveBeenCalledOnce();
    expect(a.deps.exit).not.toHaveBeenCalled();
    expect(backNotice.shown).toBe(false);

    const b = setup({ pack: true });
    b.back({ canGoBack: true });
    b.back({ canGoBack: false });
    b.back({ canGoBack: false });
    expect(b.deps.goBack).not.toHaveBeenCalled();
    expect(b.deps.exit).not.toHaveBeenCalled();
  });

  it('the notice stays for the whole window and disappears when it ends', () => {
    vi.useFakeTimers();
    try {
      const { back } = setup();
      back({ canGoBack: false });
      vi.advanceTimersByTime(EXIT_WINDOW_MS - 1);
      expect(backNotice.shown).toBe(true);
      vi.advanceTimersByTime(1);
      expect(backNotice.shown).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
