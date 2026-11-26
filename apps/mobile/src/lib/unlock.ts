/**
 * The phone's own unlock (fingerprint/face, or the screen-lock PIN, pattern or
 * password) before an adult gets their account back from a child.
 */
import { isNative } from './native.js';

/** `password`: the phone has no screen lock (or this is a browser), ask for the app password. */
export type UnlockResult = 'ok' | 'cancelled' | 'password';

export async function unlockPhone(): Promise<UnlockResult> {
  if (!isNative) return 'password';
  const { BiometricAuth, BiometryError, BiometryErrorType } = await import('@aparajita/capacitor-biometric-auth');
  try {
    const info = await BiometricAuth.checkBiometry();
    if (!info.deviceIsSecure) return 'password';
    await BiometricAuth.authenticate({
      reason: 'Wróć do konta rodzica',
      cancelTitle: 'Anuluj',
      allowDeviceCredential: true,
      androidTitle: 'Wróć do rodzica',
      androidSubtitle: 'Odblokuj tak jak telefon',
      androidConfirmationRequired: false,
    });
    return 'ok';
  } catch (e) {
    const cancelled = [BiometryErrorType.userCancel, BiometryErrorType.appCancel, BiometryErrorType.systemCancel];
    if (e instanceof BiometryError && cancelled.includes(e.code)) return 'cancelled';
    // Lockout or an unsupported phone: the app password still works.
    return 'password';
  }
}
