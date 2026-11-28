import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.choreapp.family',
  appName: 'Zadania',
  webDir: 'build',
  android: {
    // Plain HTTP API only for local development builds.
    allowMixedContent: false,
    // The web build targets Chrome 88 (vite.config.ts). Older Android System
    // WebViews get server.errorPath instead of a broken app.
    minWebViewVersion: 88,
  },
  server: {
    // Static page in static/; no links out (children use the app).
    errorPath: 'webview.html',
  },
  plugins: {
    PushNotifications: {
      // The app shows its own banner while open; a system heads-up on top of it would be a duplicate.
      presentationOptions: [],
    },
  },
};

export default config;
