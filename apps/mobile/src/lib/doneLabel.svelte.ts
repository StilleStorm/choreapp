/**
 * The big button's text: each theme has its own ("BAM!", "Kwak!", ...). The
 * default and gendered labels follow the child's choice of "Zrobiłem/Zrobiłam",
 * stored on the phone.
 */
import { Preferences } from '@capacitor/preferences';
import { THEME_LIST } from './themes/themes.js';

export type DoneForm = 'm' | 'f';
const KEY = 'done_form';

class DoneLabel {
  form = $state<DoneForm>('m');

  async load(): Promise<void> {
    const v = (await Preferences.get({ key: KEY })).value;
    if (v === 'm' || v === 'f') this.form = v;
  }

  async set(form: DoneForm): Promise<void> {
    this.form = form;
    await Preferences.set({ key: KEY, value: form });
  }

  for(themeId: string | undefined): string {
    const own = this.form === 'f' ? 'Zrobiłam!' : 'Zrobiłem!';
    const label = THEME_LIST.find((t) => t.id === themeId)?.doneLabel;
    if (!label || /^zrobił(am|em)!?$/i.test(label)) return own;
    return label;
  }
}

export const doneLabel = new DoneLabel();
