import { selfUpdates } from './update.svelte.js';

/** Buy Me a Coffee page of the developer. Shown to adults only, never in the child UI. */
export const SUPPORT_URL = 'https://buymeacoffee.com/stillestorq';

/**
 * Shown in both builds. The sideloaded (GitHub) build shows it via selfUpdates;
 * the Play build (`pnpm aab`) sets VITE_SHOW_SUPPORT=1. Voluntary tips to the
 * developer are peer-to-peer payments outside the app's content, which the Play
 * Payments policy FAQ exempts from Play Billing. Parent settings only.
 */
export const showSupport = selfUpdates || import.meta.env.VITE_SHOW_SUPPORT === '1';
