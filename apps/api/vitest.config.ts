import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, FILE_SIGNING_KEY: 'test-signing-key' },
        },
      }),
    ],
    // Files share one local D1; run them one after another so data doesn't race.
    test: { setupFiles: ['./test/setup.ts'], fileParallelism: false },
  };
});
