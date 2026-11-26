/**
 * Push notifications via FCM (Capacitor push plugin). The phone registers its
 * token with the API after login; tapping a notification opens the matching
 * screen; a notification arriving while the app is open shows a banner.
 * A child's phone in several homes registers the token with each of them, so
 * notifications come from every home (tapping one opens the active home).
 * An adult's phone lent to a child (session.swapped) stays registered to the
 * adult only: the child's session never registers it, so the child gets no
 * notifications there and the adult keeps theirs.
 */
import { goto } from '$app/navigation';
import { request } from './api.js';
import { isNative, appVersion } from './native.js';
import { notices } from './notices.svelte.js';
import { session } from './session.svelte.js';

let installed = false;

const SCREENS: Record<string, { parent: string; child: string }> = {
  approvals: { parent: '/parent/today', child: '/child/today' },
  rewards: { parent: '/parent/rewards', child: '/child/shop' },
  today: { parent: '/parent/today', child: '/child/today' },
  points: { parent: '/parent/kids', child: '/child/points' },
  collection: { parent: '/parent/kids', child: '/child/profile' },
};

function routeFor(screen: string | undefined): string {
  const target = (screen && SCREENS[screen]) || SCREENS.today!;
  return session.isParent ? target.parent : target.child;
}

export async function setupPush(): Promise<void> {
  if (!isNative || !__PUSH_ENABLED__ || !session.me || session.swapped) return;
  const { PushNotifications } = await import('@capacitor/push-notifications');

  if (!installed) {
    installed = true;
    await PushNotifications.createChannel({
      id: 'default',
      name: 'Zadania i nagrody',
      description: 'Nowe zadania, zatwierdzenia, przypomnienia',
      importance: 4,
      visibility: 1,
    }).catch(() => {});
    await PushNotifications.addListener('registration', async ({ value }) => {
      if (session.swapped) return;
      const v = await appVersion().catch(() => null);
      for (const home of session.homes.list) {
        try {
          await request('POST', '/v1/devices', { token: home.token, json: { pushToken: value, appVersion: v?.name } });
        } catch {
          /* retried on next start; a 401 drops that home */
        }
      }
    });
    await PushNotifications.addListener('registrationError', (e) => console.warn('push registration failed', e));
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      void goto(routeFor((notification.data as Record<string, string> | undefined)?.screen));
    });
    await PushNotifications.addListener('pushNotificationReceived', (n) => {
      notices.show(n.title ?? 'Powiadomienie', n.body ?? '', routeFor((n.data as Record<string, string> | undefined)?.screen));
    });
  }

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return;
  await PushNotifications.register();
}
