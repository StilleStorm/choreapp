/**
 * The families ("homes") a phone is logged in to. A child's phone can belong to
 * several homes (mum's, dad's, grandparents'); each home is its own session
 * with its own member, points and stickers. Adults always have one home.
 * Pure functions, so the rules are easy to test; storage lives in the session.
 */
export interface Home {
  token: string;
  familyId: string;
  familyName: string;
  memberId: string;
  memberName: string;
}

export interface Homes {
  list: Home[];
  /** Token of the home the app shows now; null when logged out. */
  active: string | null;
}

export const NO_HOMES: Homes = { list: [], active: null };

/**
 * Reads stored homes; a phone from before 1.0.6 only has a single token, which
 * becomes a one-home list (family details are filled in after the next /me).
 */
export function restoreHomes(stored: string | null, legacyToken: string | null): Homes {
  if (stored) {
    try {
      const h = JSON.parse(stored) as Homes;
      if (Array.isArray(h.list)) {
        const list = h.list.filter((x) => x && typeof x.token === 'string' && x.token);
        const active = list.some((x) => x.token === h.active) ? h.active : (list[0]?.token ?? null);
        return { list, active };
      }
    } catch {
      /* corrupted: fall back to the legacy token */
    }
  }
  if (!legacyToken) return NO_HOMES;
  return { list: [{ token: legacyToken, familyId: '', familyName: '', memberId: '', memberName: '' }], active: legacyToken };
}

export function activeHome(h: Homes): Home | null {
  return h.list.find((x) => x.token === h.active) ?? null;
}

/** Adds a home and makes it active; joining the same family again replaces its entry. */
export function addHome(h: Homes, home: Home): Homes {
  const list = h.list.filter((x) => x.token !== home.token && !(home.familyId && x.familyId === home.familyId));
  return { list: [...list, home], active: home.token };
}

/** Removes a home; when it was the active one, the first remaining home becomes active. */
export function removeHome(h: Homes, token: string): Homes {
  const list = h.list.filter((x) => x.token !== token);
  const active = h.active !== token && list.some((x) => x.token === h.active) ? h.active : (list[0]?.token ?? null);
  return { list, active };
}

export function switchHome(h: Homes, token: string): Homes {
  return h.list.some((x) => x.token === token) ? { ...h, active: token } : h;
}

/** Fresh names from the server (and family/member ids for migrated homes). */
export function updateHome(h: Homes, token: string, details: Omit<Home, 'token'>): Homes {
  return { ...h, list: h.list.map((x) => (x.token === token ? { ...details, token } : x)) };
}
