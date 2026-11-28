/**
 * The native self-updater of the sideloaded APK (android/app/src/sideload).
 * Not in the Google Play build: there selfUpdates is false and nothing calls it.
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface DownloadResult {
  size: number;
  sha256: string;
  versionCode: number;
}

interface AppUpdaterPlugin {
  canInstall(): Promise<{ granted: boolean }>;
  openInstallSettings(): Promise<void>;
  download(opts: { url: string; size?: number; sha256?: string }): Promise<DownloadResult>;
  install(): Promise<void>;
  addListener(event: 'progress', fn: (p: { downloaded: number; total: number }) => void): Promise<PluginListenerHandle>;
}

export const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

const ERRORS: Record<string, string> = {
  network: 'Nie udało się pobrać aktualizacji. Sprawdź internet i spróbuj ponownie.',
  size_mismatch: 'Pobrany plik jest niepełny. Spróbuj ponownie.',
  checksum_mismatch: 'Pobrany plik jest uszkodzony. Spróbuj ponownie.',
  wrong_package: 'Pobrany plik nie jest aktualizacją tej aplikacji.',
  install_failed: 'Nie udało się otworzyć instalatora. Spróbuj ponownie.',
  no_file: 'Najpierw pobierz aktualizację.',
  busy: 'Aktualizacja już się pobiera.',
};

/** Polish message for a native error code (Capacitor puts it in `code`). */
export function updaterError(e: unknown): string {
  const code = (e as { code?: string } | null)?.code ?? '';
  return ERRORS[code] ?? (code.startsWith('http_') ? ERRORS.network! : 'Coś poszło nie tak z aktualizacją. Spróbuj ponownie.');
}
