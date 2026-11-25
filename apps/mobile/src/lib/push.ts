/**
 * Push notifications via FCM (Capacitor push plugin). The phone registers its
 * token with the API after login; tapping a notification opens the matching
 * screen; a notification arriving while the app is open shows a banner.
 */
import { goto } from '$app/navigation';
import { api } from './api.js';
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
  if (!isNative || !__PUSH_ENABLED__ || !session.me) return;
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
      try {
        const v = await appVersion();
        await api.post('/v1/devices', { pushToken: value, appVersion: v.name });
      } catch {
        /* retried on next start */
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
