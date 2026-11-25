import { ADULT_HIDDEN_THEMES, NEUTRAL_THEME } from '@choreapp/shared';
import { THEME_LIST, type ThemeInfo } from './themes.js';

/** The adults' default: no data-theme, just the base tokens from app.css. */
export const NEUTRAL: ThemeInfo = {
  id: NEUTRAL_THEME,
  title: 'Domyślny',
  dark: false,
  preview: {
    bg: '#fff6ea',
    card: '#ffffff',
    accent: '#fa901d',
    text: '#4a2a14',
    font: "'Baloo 2', system-ui, sans-serif",
    radius: '20px',
    border: '2px solid #4a2a14',
  },
  doneLabel: 'Zatwierdź',
  decorations: '',
};

/** Themes offered to children: all 25 from the mockups. */
export const CHILD_THEMES: ThemeInfo[] = THEME_LIST;

/** Not offered to adults (shared with the API, which enforces it). */
export { ADULT_HIDDEN_THEMES };

/** Themes offered to adults: the neutral style first, then the readable ones of the 25. */
export const ADULT_THEMES: ThemeInfo[] = [NEUTRAL, ...THEME_LIST.filter((t) => !ADULT_HIDDEN_THEMES.includes(t.id))];

/** The value for <html data-theme>, or undefined for the base (neutral) style. */
export function dataThemeFor(theme: string | undefined): string | undefined {
  return theme && theme !== NEUTRAL_THEME ? theme : undefined;
}
