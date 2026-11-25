import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.choreapp.family',
  appName: 'Zadania',
  webDir: 'build',
  android: {
    // Plain HTTP API only for local development builds.
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      // The app shows its own banner while open; a system heads-up on top of it would be a duplicate.
      presentationOptions: [],
    },
  },
};

export default config;
