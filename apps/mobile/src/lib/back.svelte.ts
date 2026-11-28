/**
 * Android back button / back gesture. Order: an open sheet closes first;
 * during a pack opening nothing happens; inside the app it goes back; on a
 * root screen (nothing to go back to) the first press only shows a notice and
 * a second press within EXIT_WINDOW_MS leaves the app (the notice stays
 * exactly that long, with a bar showing the time left), so a stray back
 * gesture doesn't close it by accident.
 */
export const EXIT_WINDOW_MS = 2000;

/** The "press again to exit" notice (BackNotice.svelte shows it). */
export const backNotice = $state({ shown: false, key: 0 });

export interface BackDeps {
  now: () => number;
  /** Closes the topmost open sheet/dialog; false when none was open. */
  closeDialog: () => boolean;
  /** A sticker pack is being opened (full-screen, back does nothing). */
  packOpen: () => boolean;
  goBack: () => void;
  exit: () => void;
}

export function createBackHandler(deps: BackDeps): (e: { canGoBack: boolean }) => void {
  let armedAt: number | null = null;
  let hide: ReturnType<typeof setTimeout> | undefined;
  const disarm = () => {
    armedAt = null;
    backNotice.shown = false;
    clearTimeout(hide);
  };
  return ({ canGoBack }) => {
    if (deps.closeDialog()) return disarm();
    if (deps.packOpen()) return;
    if (canGoBack) {
      disarm();
      return deps.goBack();
    }
    const now = deps.now();
    if (armedAt !== null && now - armedAt <= EXIT_WINDOW_MS) {
      disarm();
      return deps.exit();
    }
    armedAt = now;
    backNotice.shown = true;
    backNotice.key++; // restarts the countdown bar
    clearTimeout(hide);
    hide = setTimeout(disarm, EXIT_WINDOW_MS);
  };
}
