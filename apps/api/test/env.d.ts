import type { D1Migration } from '@cloudflare/vitest-plugin';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      FILES: R2Bucket;
      FILE_SIGNING_KEY: string;
      FCM_SERVICE_ACCOUNT?: string;
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
export {};
