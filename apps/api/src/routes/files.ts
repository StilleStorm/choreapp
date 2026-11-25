import { Hono } from 'hono';
import type { AppBindings } from '../env.js';
import { verifyFileSignature } from '../lib/files.js';
import { ApiError } from '../lib/http.js';

export const files = new Hono<AppBindings>().get('/files/*', async (c) => {
  const key = decodeURI(new URL(c.req.url).pathname.replace(/^\/v1\/files\//, ''));
  const ok = await verifyFileSignature(c.env, key, c.req.query('e') ?? '', c.req.query('s') ?? '');
  if (!ok) throw new ApiError(403, 'bad_signature');
  const obj = await c.env.FILES.get(key);
  if (!obj) throw new ApiError(404, 'not_found');
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  headers.set('Cache-Control', 'private, max-age=604800, immutable');
  // SVG stickers come from packs: never let them run scripts.
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(obj.body, { headers });
});
