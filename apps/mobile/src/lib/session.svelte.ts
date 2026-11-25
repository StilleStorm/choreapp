/** Logged-in member, family and members, shared by every screen. */
import type { FamilyDto, MeDto, MemberDto, SessionDto } from '@choreapp/shared';
import { goto } from '$app/navigation';
import { ApiFailure, api, hasToken, loadToken, saveToken, setUnauthorizedHandler } from './api.js';

class Session {
  ready = $state(false);
  data = $state<MeDto | null>(null);
  /** Offset between server and phone clocks, so "today" follows the server. */
  clockSkew = 0;

  get me(): MemberDto | null {
    return this.data?.me ?? null;
  }
  get family(): FamilyDto | null {
    return this.data?.family ?? null;
  }
  get members(): MemberDto[] {
    return this.data?.members ?? [];
  }
  get children(): MemberDto[] {
    return this.members.filter((m) => m.role === 'child');
  }
  get parents(): MemberDto[] {
    return this.members.filter((m) => m.role === 'parent');
  }
  get isParent(): boolean {
    return this.me?.role === 'parent';
  }
  get today(): string {
    return this.data?.today ?? new Date().toISOString().slice(0, 10);
  }
  now(): number {
    return Date.now() + this.clockSkew;
  }
  member(id: string): MemberDto | undefined {
    return this.members.find((m) => m.id === id);
  }

  async init(): Promise<void> {
    setUnauthorizedHandler(() => void this.signOut(false));
    await loadToken();
    if (hasToken()) {
      try {
        await this.refresh();
      } catch (e) {
        // Offline at startup: keep the token, screens show cached/empty state.
        if (!(e instanceof ApiFailure) || e.status === 401) await saveToken(null);
      }
    }
    this.ready = true;
  }

  async refresh(): Promise<void> {
    const data = await api.get<MeDto>('/v1/me');
    this.clockSkew = data.now - Date.now();
    this.data = data;
  }

  async signIn(s: SessionDto): Promise<void> {
    await saveToken(s.token);
    await this.refresh();
  }

  async signOut(callServer = true): Promise<void> {
    if (callServer) {
      try {
        await api.post('/v1/auth/logout');
      } catch {
        /* already invalid or offline */
      }
    }
    await saveToken(null);
    this.data = null;
    await goto('/welcome', { replaceState: true });
  }

  /** Where the logged-in member belongs. */
  home(): string {
    if (!this.me) return '/welcome';
    return this.me.role === 'parent' ? '/parent' : '/child';
  }
}

export const session = new Session();
