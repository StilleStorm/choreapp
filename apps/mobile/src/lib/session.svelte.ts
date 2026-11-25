/** Logged-in member, family and members, shared by every screen. */
import type { FamilyDto, MeDto, MemberDto, SessionDto } from '@choreapp/shared';
import { goto } from '$app/navigation';
import { Preferences } from '@capacitor/preferences';
import { ApiFailure, api, hasToken, request, setToken, setUnauthorizedHandler } from './api.js';
import { offline } from './offline.svelte.js';
import { NO_HOMES, activeHome, addHome, removeHome, restoreHomes, switchHome, updateHome, type Home, type Homes } from './homes.js';

const HOMES_KEY = 'homes';
/** Reload /me when the app returns after this long (signed image URLs live 24-48 h). */
const RESUME_REFRESH_MS = 30 * 60_000;
/** Before 1.0.6 the phone kept a single token; still written for the active home. */
const LEGACY_TOKEN_KEY = 'session_token';

class Session {
  ready = $state(false);
  data = $state<MeDto | null>(null);
  /** Families this phone is logged in to (several only on a child's phone). */
  homes = $state<Homes>(NO_HOMES);
  /** Offset between server and phone clocks, so "today" follows the server. */
  clockSkew = 0;
  /** A home being dropped after a 401, so callers can wait for the fallback. */
  private dropping: Promise<void> = Promise.resolve();
  /** The running check of the other homes, so overlapping calls share it. */
  private checking: Promise<void> | null = null;
  /** When /me last succeeded (phone clock), to refresh signed image URLs after a long pause. */
  private refreshedAt = 0;

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
  /** The adult who registered the family: manages settings, adults and removals. */
  get isAdmin(): boolean {
    return !!this.me && this.family?.adminMemberId === this.me.id;
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

  /** Only shown when a child's phone belongs to more than one home. */
  get activeFamilyName(): string | null {
    return this.homes.list.length > 1 ? (this.family?.name ?? null) : null;
  }

  async init(): Promise<void> {
    setUnauthorizedHandler((token) => {
      this.dropping = this.dropping.then(() => this.dropHome(token));
    });
    const [stored, legacy] = await Promise.all([
      Preferences.get({ key: HOMES_KEY }),
      Preferences.get({ key: LEGACY_TOKEN_KEY }),
    ]);
    await this.setHomes(restoreHomes(stored.value, legacy.value));
    if (hasToken()) {
      try {
        await this.refresh();
      } catch (e) {
        // Offline at startup: keep the token, screens show cached/empty state.
        // A 401 drops that home and falls back to another one.
        if (!(e instanceof ApiFailure)) await this.setHomes(NO_HOMES);
        await this.dropping;
      }
    }
    this.ready = true;
    // Homes a parent removed meanwhile disappear without opening Profil.
    void this.checkHomes();
  }

  /**
   * The app came back to the foreground: after a long pause reload /me (names,
   * fresh signed image URLs) and check the other homes. Throttled, so switching
   * apps back and forth costs nothing.
   */
  async resume(): Promise<void> {
    if (!this.homes.active || Date.now() - this.refreshedAt < RESUME_REFRESH_MS) return;
    try {
      await this.refresh();
    } catch {
      /* offline or dropped (handled by the 401 handler) */
    }
    await this.checkHomes();
  }

  private async setHomes(h: Homes): Promise<void> {
    this.homes = h;
    setToken(h.active);
    await Promise.all([
      Preferences.set({ key: HOMES_KEY, value: JSON.stringify(h) }),
      h.active ? Preferences.set({ key: LEGACY_TOKEN_KEY, value: h.active }) : Preferences.remove({ key: LEGACY_TOKEN_KEY }),
    ]);
  }

  async refresh(): Promise<void> {
    const token = this.homes.active;
    const data = await api.get<MeDto>('/v1/me');
    if (token !== this.homes.active) return; // switched meanwhile
    this.clockSkew = data.now - Date.now();
    this.refreshedAt = Date.now();
    this.data = data;
    const home = activeHome(this.homes);
    if (token && home && (home.familyName !== data.family.name || home.memberName !== data.me.name || !home.familyId)) {
      await this.setHomes(updateHome(this.homes, token, detailsOf(data)));
    }
  }

  /**
   * Logged in or joined. A child joining another family adds a home to the
   * phone; everything else (adults, a phone that had an adult) replaces it.
   */
  async signIn(s: SessionDto): Promise<void> {
    const home: Home = { token: s.token, ...detailsOf(s) };
    const keep = s.me.role === 'child' && this.me?.role !== 'parent';
    const replaced = keep ? this.homes.list.find((h) => h.familyId === s.family.id && h.token !== s.token) : undefined;
    await this.setHomes(addHome(keep ? this.homes : NO_HOMES, home));
    await this.refresh();
    // A second profile in the same family: the old one's session is not needed.
    if (replaced) void logoutToken(replaced.token);
  }

  /** Shows another home on a child's phone. */
  async switchTo(token: string): Promise<void> {
    if (token === this.homes.active) return;
    await offline.flush(); // queued taps belong to the current home
    const before = this.homes.active;
    await this.setHomes(switchHome(this.homes, token));
    try {
      await this.refresh();
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) {
        // That home is gone: it was dropped and the app moved to another one.
        await this.dropping;
      } else if (before) {
        // Offline: stay in the current home.
        await this.setHomes(switchHome(this.homes, before));
      }
      throw e;
    }
  }

  /** "Usuń ten dom z telefonu": logs out that home's session and forgets it. */
  async leaveHome(token: string): Promise<void> {
    await this.dropHome(token);
    void logoutToken(token);
  }

  /** Forgets a home (removed by a parent, or left); falls back to another one. */
  private async dropHome(token: string): Promise<void> {
    if (!this.homes.list.some((h) => h.token === token)) return;
    const wasActive = token === this.homes.active;
    await this.setHomes(removeHome(this.homes, token));
    if (!wasActive) return;
    if (!this.homes.active) {
      this.data = null;
      await goto('/welcome', { replace: true });
      return;
    }
    try {
      await this.refresh();
    } catch {
      /* offline: screens show empty state until the next refresh */
    }
    await goto(this.home(), { replace: true });
  }

  /**
   * Checks the other homes (names, removed by a parent): one /me per other home.
   * Only saves when something changed, so it never wakes up readers of `homes`
   * for nothing (an $effect reading `homes` must still not call it: use onMount).
   */
  checkHomes(): Promise<void> {
    this.checking ??= this.checkOtherHomes().finally(() => (this.checking = null));
    return this.checking;
  }

  private async checkOtherHomes(): Promise<void> {
    const others = this.homes.list.filter((h) => h.token !== this.homes.active);
    for (const h of others) {
      try {
        const data = await request<MeDto>('GET', '/v1/me', { token: h.token });
        const next = updateHome(this.homes, h.token, detailsOf(data));
        if (next !== this.homes) await this.setHomes(next);
      } catch {
        /* 401 dropped it; offline keeps it */
      }
    }
  }

  async signOut(callServer = true): Promise<void> {
    if (callServer) {
      try {
        await api.post('/v1/auth/logout');
      } catch {
        /* already invalid or offline */
      }
    }
    await this.setHomes(NO_HOMES);
    this.data = null;
    await goto('/welcome', { replace: true });
  }

  /** Where the logged-in member belongs. */
  home(): string {
    if (!this.me) return '/welcome';
    return this.me.role === 'parent' ? '/parent' : '/child';
  }
}

function detailsOf(s: { me: MemberDto; family: FamilyDto }): Omit<Home, 'token'> {
  return { familyId: s.family.id, familyName: s.family.name, memberId: s.me.id, memberName: s.me.name };
}

async function logoutToken(token: string): Promise<void> {
  try {
    await request('POST', '/v1/auth/logout', { token, json: {} });
  } catch {
    /* already invalid or offline */
  }
}

export const session = new Session();
