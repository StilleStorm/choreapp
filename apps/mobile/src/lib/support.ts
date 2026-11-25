import { selfUpdates } from './update.svelte.js';

/** Buy Me a Coffee page of the developer. Shown to adults only, never in the child UI. */
export const SUPPORT_URL = 'https://buymeacoffee.com/stillestorq';

/**
 * Google Play may treat tips to the developer as digital payments that must go
 * through Play Billing, so the Play build hides the link unless built with
 * VITE_SHOW_SUPPORT=1. The sideloaded (GitHub) build always shows it.
 */
export const showSupport = selfUpdates || import.meta.env.VITE_SHOW_SUPPORT === '1';
