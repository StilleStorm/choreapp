/**
 * Manual updates for the sideloaded APK: compare the installed build with the
 * latest release. The Google Play build (VITE_DISTRIBUTION=play, `pnpm aab`)
 * never checks: Play forbids updating apps outside the store.
 */
import type { AppReleaseDto } from '@choreapp/shared';
import { api } from './api.js';
import { appVersion, isNative } from './native.js';
import { notices } from './notices.svelte.js';

export const selfUpdates = import.meta.env.VITE_DISTRIBUTION !== 'play';

class Update {
  latest = $state<AppReleaseDto | null>(null);
  installed = $state<{ name: string; code: number }>({ name: 'web', code: 0 });
  available = $state(false);
  private checked = false;

  async check(): Promise<void> {
    if (this.checked) return;
    this.checked = true;
    try {
      this.installed = await appVersion();
      if (!selfUpdates) return;
      this.latest = await api.get<AppReleaseDto | null>('/v1/app/latest');
      this.available = isNative && !!this.latest && this.latest.versionCode > this.installed.code;
      if (this.available) notices.show('Nowa wersja aplikacji', `Wersja ${this.latest!.versionName} czeka. Dotknij, żeby pobrać.`, '/update');
    } catch {
      this.checked = false;
    }
  }
}

export const update = new Update();
