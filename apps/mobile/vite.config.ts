/// <reference types="vitest/config" />
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { existsSync } from 'node:fs';
import { defineConfig } from 'vite';

export default defineConfig({
  // Push needs Firebase in the native build. Without google-services.json,
  // PushNotifications.register() crashes the app, so the web code must skip it.
  define: { __PUSH_ENABLED__: JSON.stringify(existsSync('android/app/google-services.json')) },
  plugins: [
    sveltekit({
      compilerOptions: {
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
      },
      // Single-page app packaged by Capacitor: everything falls back to index.html.
      adapter: adapter({ pages: 'build', assets: 'build', fallback: 'index.html' }),
    }),
  ],
  test: { include: ['src/**/*.test.ts'] },
});
