/** Manual updates (no Google Play): compare the installed build with the latest release. */
import type { AppReleaseDto } from '@choreapp/shared';
import { api } from './api.js';
import { appVersion, isNative } from './native.js';
import { notices } from './notices.svelte.js';

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
      this.latest = await api.get<AppReleaseDto | null>('/v1/app/latest');
      this.available = isNative && !!this.latest && this.latest.versionCode > this.installed.code;
      if (this.available) notices.show('Nowa wersja aplikacji', `Wersja ${this.latest!.versionName} czeka. Dotknij, żeby pobrać.`, '/update');
    } catch {
      this.checked = false;
    }
  }
}

export const update = new Update();
