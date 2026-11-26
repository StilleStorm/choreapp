/// <reference types="vitest/config" />
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

function pushEnabled(): boolean {
  const file = 'android/app/google-services.json';
  if (!existsSync(file)) return false;
  return process.env.VITE_DISTRIBUTION !== 'staging' || readFileSync(file, 'utf8').includes('"app.choreapp.family.staging"');
}

export default defineConfig({
  // Push needs Firebase in the native build. Without google-services.json (or,
  // for the test build app.choreapp.family.staging, without that package in it),
  // PushNotifications.register() crashes the app, so the web code must skip it.
  define: { __PUSH_ENABLED__: JSON.stringify(pushEnabled()) },
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
