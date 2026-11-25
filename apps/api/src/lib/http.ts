import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

/** Errors carry a stable English code; the app maps codes to Polish messages. */
export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const notFound = (what = 'not_found') => new ApiError(404, what);
export const forbidden = (what = 'forbidden') => new ApiError(403, what);
export const badRequest = (what: string) => new ApiError(400, what);
export const conflict = (what: string) => new ApiError(409, what);

export async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest('invalid_json');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, 'invalid_input', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return parsed.data;
}

export function query<S extends z.ZodType>(c: Context, schema: S): z.infer<S> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw new ApiError(400, 'invalid_query', parsed.error.issues.map((i) => i.message).join('; '));
  return parsed.data;
}

/**
 * Runs work after the response (push notifications). In the Workers runtime
 * this uses waitUntil and returns at once; without an execution context
 * (tests) it simply awaits the work. Failures are logged, never surfaced.
 */
export async function background(c: Context, work: Promise<unknown>): Promise<void> {
  const safe = work.catch((e) => console.error('background task failed', e));
  let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined;
  }
  if (ctx) ctx.waitUntil(safe);
  else await safe;
}
