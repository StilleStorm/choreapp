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
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
