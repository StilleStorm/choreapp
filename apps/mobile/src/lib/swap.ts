/**
 * A child without a phone uses an adult's phone: the adult switches the app into
 * the child's account and back. While switched, the adult's session waits on the
 * phone and only the child screens are reachable (Google Play Families: no adult
 * screens for the child). Pure rules here, so they are easy to test.
 */

/** Screens a child may open while using an adult's phone. */
const CHILD_PATHS = ['/child', '/about', '/licenses'];

/**
 * Where the app must go instead of `path` while switched into a child's account,
 * or null when the path is allowed. Without a child session (it was logged out)
 * only the welcome screen remains, which then offers the way back to the adult.
 */
export function swapRedirect(path: string, childSignedIn: boolean): string | null {
  if (!childSignedIn) return path === '/welcome' ? null : '/welcome';
  const allowed = CHILD_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  return allowed ? null : '/child';
}
