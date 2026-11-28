/**
 * In-app banner for notifications that arrive while the app is open.
 * NoticeBanner shows it, but never over a sticker pack being opened: it waits
 * until the last pack is closed. A normal notice hides 6 s after it appears;
 * a sticky one (the update notice for a child) stays until tapped or closed.
 */
export const NOTICE_MS = 6000;

export interface Notice {
  title: string;
  body: string;
  href: string;
  sticky: boolean;
}

class Notices {
  current = $state<Notice | null>(null);

  show(title: string, body: string, href: string, opts: { sticky?: boolean } = {}): void {
    this.current = { title, body, href, sticky: opts.sticky ?? false };
  }

  dismiss(): void {
    this.current = null;
  }
}

export const notices = new Notices();
