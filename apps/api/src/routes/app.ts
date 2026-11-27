/** APK updates of the sideloaded app: it asks for the latest release, downloads and checks it itself. */
import type { AppReleaseDto } from '@choreapp/shared';
import { Hono } from 'hono';
import type { AppBindings } from '../env.js';
import { first } from '../lib/db.js';
import { signedFileUrl } from '../lib/files.js';

export const appRelease = new Hono<AppBindings>().get('/app/latest', async (c) => {
  const r = await first<{
    version_code: number;
    version_name: string;
    apk_key: string;
    notes: string | null;
    apk_size: number | null;
    apk_sha256: string | null;
  }>(c.env.DB, 'SELECT * FROM app_release ORDER BY version_code DESC LIMIT 1');
  if (!r) return c.json(null);
  const dto: AppReleaseDto = {
    versionCode: r.version_code,
    versionName: r.version_name,
    url: await signedFileUrl(c.env, new URL(c.req.url).origin, r.apk_key),
    notes: r.notes,
    size: r.apk_size ?? (await c.env.FILES.head(r.apk_key))?.size ?? null,
    sha256: r.apk_sha256,
  };
  return c.json(dto);
});
