import { selfUpdates } from './update.svelte.js';

/**
 * Where adults can tip the developer, per app language. The app is Polish-only
 * today, so Suppi (Polish tipping service) is used. Buy Me a Coffee stays here
 * for future non-Polish versions.
 */
const SUPPORT_LINKS = {
  pl: { url: 'https://suppi.pl/stillestormstudio', label: 'Wesprzyj twórcę (Suppi)' },
  en: { url: 'https://buymeacoffee.com/stillestorq', label: 'Buy me a coffee' },
} as const;

const support = SUPPORT_LINKS.pl;

/** Shown to adults only, never in the child UI. */
export const SUPPORT_URL: string = support.url;
export const SUPPORT_LABEL: string = support.label;

/**
 * Shown in both builds. The sideloaded (GitHub) build shows it via selfUpdates;
 * the Play build (`pnpm aab`) sets VITE_SHOW_SUPPORT=1. Voluntary tips to the
 * developer are peer-to-peer payments outside the app's content, which the Play
 * Payments policy FAQ exempts from Play Billing. Parent settings only.
 */
export const showSupport = selfUpdates || import.meta.env.VITE_SHOW_SUPPORT === '1';
