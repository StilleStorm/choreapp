import type { ItemDto } from '@choreapp/shared';
import { THEME_LIST } from './themes/themes.js';

export interface ThemeAvatarGroup {
  theme: string;
  title: string;
  items: ItemDto[];
}

/**
 * Splits the theme avatars into the member's own theme ("Twój motyw") and the
 * other themes, in the order of the theme list. Adults on the neutral style
 * have no own group.
 */
export function groupThemeAvatars(items: ItemDto[], ownTheme: string | undefined): { own: ItemDto[]; others: ThemeAvatarGroup[] } {
  const byTheme = new Map<string, ItemDto[]>();
  for (const i of items) {
    if (!i.theme) continue;
    byTheme.set(i.theme, [...(byTheme.get(i.theme) ?? []), i]);
  }
  const order = [...THEME_LIST.map((t) => t.id), ...[...byTheme.keys()].filter((id) => !THEME_LIST.some((t) => t.id === id))];
  const others: ThemeAvatarGroup[] = [];
  for (const theme of order) {
    const list = byTheme.get(theme);
    if (!list?.length || theme === ownTheme) continue;
    others.push({ theme, title: THEME_LIST.find((t) => t.id === theme)?.title ?? list[0]!.album, items: list });
  }
  return { own: (ownTheme && byTheme.get(ownTheme)) || [], others };
}
