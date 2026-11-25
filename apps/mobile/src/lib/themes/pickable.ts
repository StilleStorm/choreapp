import { NEUTRAL_THEME } from '@choreapp/shared';
import { THEME_LIST, type ThemeInfo } from './themes.js';

/** The adults' default: no data-theme, just the base tokens from app.css. */
export const NEUTRAL: ThemeInfo = {
  id: NEUTRAL_THEME,
  title: 'Neutralny',
  dark: false,
  preview: {
    bg: '#f6f7f9',
    card: '#ffffff',
    accent: '#3858e9',
    text: '#16181d',
    font: 'system-ui, sans-serif',
    radius: '14px',
    border: '1px solid #dde1e8',
  },
  doneLabel: 'Zatwierdź',
  decorations: '',
};

/** Themes offered to children: all 25 from the mockups. */
export const CHILD_THEMES: ThemeInfo[] = THEME_LIST;

/**
 * Not offered to adults: dark pages with light cards. Their light inputs, chips,
 * plain buttons and sheet titles sit outside the cards in the adults' forms and
 * get the page's light text colour, so they are unreadable there.
 */
export const ADULT_HIDDEN_THEMES = ['guild', 'lanterns', 'detective'];

/** Themes offered to adults: the neutral style first, then the readable ones of the 25. */
export const ADULT_THEMES: ThemeInfo[] = [NEUTRAL, ...THEME_LIST.filter((t) => !ADULT_HIDDEN_THEMES.includes(t.id))];

/** The value for <html data-theme>, or undefined for the base (neutral) style. */
export function dataThemeFor(theme: string | undefined): string | undefined {
  return theme && theme !== NEUTRAL_THEME ? theme : undefined;
}
