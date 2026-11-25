/** In-app banner for notifications that arrive while the app is open. */
class Notices {
  current = $state<{ title: string; body: string; href: string } | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(title: string, body: string, href: string): void {
    this.current = { title, body, href };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => (this.current = null), 6000);
  }

  dismiss(): void {
    this.current = null;
  }
}

export const notices = new Notices();
