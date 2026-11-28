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
  // Children's phones can run an Android System WebView that never updated
  // (Chrome 8x-10x). Chrome 88 is the floor (capacitor.config.ts refuses
  // older): Svelte's scoped CSS and app.css use :where()/:is(). `target` keeps
  // the JS syntax at that level; `cssTarget` stays lower so the CSS minifier
  // does not turn plain top/right/bottom/left into `inset` (Chrome 87+) and
  // the like, which made full-screen layers such as the sticker pack lose
  // their size.
  build: { target: 'chrome88', cssTarget: ['chrome80'] },
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
