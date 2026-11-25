import { goto } from '$app/navigation';
import { session } from './session.svelte.js';

/**
 * For the logged-out screens (welcome, login, register): someone already
 * logged in (e.g. pressing Back from the home screen) goes back home instead,
 * so a child can't join the same family twice by accident. Adding another home
 * goes through Profil → "Dodaj kolejny dom".
 */
export function leaveIfSignedIn(): void {
  const signedIn = $derived(session.ready && !!session.me);
  $effect(() => {
    if (signedIn) void goto(session.home(), { replace: true });
  });
}
