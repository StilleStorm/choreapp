/** Thin wrappers around Capacitor plugins, safe to call in a desktop browser. */
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

/** Extracts the invite token from a scanned or opened `choreapp://join?t=...` link. */
export function inviteTokenFrom(text: string): string | null {
  try {
    const url = new URL(text);
    if (url.protocol === 'choreapp:' && url.searchParams.get('t')) return url.searchParams.get('t');
  } catch {
    /* not a URL */
  }
  return /^[A-Za-z0-9_-]{30,100}$/.test(text) ? text : null;
}

/**
 * Opens Google's code scanner (no camera permission needed, the scanning UI is
 * provided by Play services). Returns null when cancelled.
 */
export async function scanQr(): Promise<string | null> {
  const { BarcodeScanner, BarcodeFormat } = await import('@capacitor-mlkit/barcode-scanning');
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    await BarcodeScanner.installGoogleBarcodeScannerModule();
    throw new Error('scanner_installing');
  }
  try {
    const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
    return barcodes[0]?.rawValue ?? null;
  } catch (e) {
    if (String(e).toLowerCase().includes('cancel')) return null;
    throw e;
  }
}

/** Android back button and deep links. */
export async function installNativeHandlers(onInviteLink: (token: string) => void): Promise<void> {
  if (!isNative) return;
  const { App } = await import('@capacitor/app');
  const { createBackHandler } = await import('./back.svelte.js');
  const { packs } = await import('./packs.svelte.js');
  const onBack = createBackHandler({
    now: Date.now,
    closeDialog: () => {
      const open = document.querySelectorAll('dialog[open]');
      const dialog = open[open.length - 1] as HTMLDialogElement | undefined;
      dialog?.close();
      return !!dialog;
    },
    packOpen: () => !!packs.current,
    goBack: () => history.back(),
    exit: () => void App.minimizeApp(),
  });
  await App.addListener('backButton', onBack);
  await App.addListener('appUrlOpen', ({ url }) => {
    const token = inviteTokenFrom(url);
    if (token) onInviteLink(token);
  });
  const launch = await App.getLaunchUrl();
  const token = launch?.url ? inviteTokenFrom(launch.url) : null;
  if (token) onInviteLink(token);
}

export async function appVersion(): Promise<{ name: string; code: number }> {
  if (!isNative) return { name: 'web', code: 0 };
  const { App } = await import('@capacitor/app');
  const info = await App.getInfo();
  return { name: info.version, code: Number(info.build) || 0 };
}

let haptics: Promise<typeof import('@capacitor/haptics')> | null = null;

/** A short vibration (sticker packs). Does nothing in a desktop browser. */
export async function haptic(kind: 'light' | 'medium' | 'heavy' | 'success'): Promise<void> {
  if (!isNative) return;
  try {
    haptics ??= import('@capacitor/haptics');
    const { Haptics, ImpactStyle, NotificationType } = await haptics;
    if (kind === 'success') await Haptics.notification({ type: NotificationType.Success });
    else await Haptics.impact({ style: { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy }[kind] });
  } catch {
    /* no vibration motor or plugin: fine */
  }
}
