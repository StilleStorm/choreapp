/** Thin helpers over D1 prepared statements. */

export type Bindable = string | number | null;

export function stmt(db: D1Database, sql: string, ...args: Bindable[]): D1PreparedStatement {
  return db.prepare(sql).bind(...args);
}

export async function first<T>(db: D1Database, sql: string, ...args: Bindable[]): Promise<T | null> {
  return (await stmt(db, sql, ...args).first<T>()) ?? null;
}

export async function all<T>(db: D1Database, sql: string, ...args: Bindable[]): Promise<T[]> {
  return (await stmt(db, sql, ...args).all<T>()).results;
}

export async function run(db: D1Database, sql: string, ...args: Bindable[]): Promise<D1Result> {
  return stmt(db, sql, ...args).run();
}

/** "?, ?, ?" for an IN (...) clause. */
export function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

/**
 * D1 caps bound parameters per statement (100). Splits an IN list into
 * chunks and concatenates the results.
 */
export async function allIn<T>(
  db: D1Database,
  sqlWithIn: (ph: string) => string,
  ids: readonly string[],
  ...extra: Bindable[]
): Promise<T[]> {
  if (ids.length === 0) return [];
  const out: T[] = [];
  const size = 90 - extra.length;
  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    out.push(...(await all<T>(db, sqlWithIn(placeholders(chunk.length)), ...chunk, ...extra)));
  }
  return out;
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

/** Fixed-window rate limiter stored in D1. Returns false when over the limit. */
export async function hit(db: D1Database, key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const row = await first<{ window_start: number; count: number }>(
    db,
    'SELECT window_start, count FROM rate_limit WHERE key = ?',
    key,
  );
  if (!row || now - row.window_start >= windowMs) {
    await run(
      db,
      'INSERT INTO rate_limit (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start, count = 1',
      key,
      now,
    );
    return true;
  }
  if (row.count >= limit) return false;
  await run(db, 'UPDATE rate_limit SET count = count + 1 WHERE key = ?', key);
  return true;
}

export async function isLimited(db: D1Database, key: string, limit: number, windowMs: number, now = Date.now()): Promise<boolean> {
  const row = await first<{ window_start: number; count: number }>(
    db,
    'SELECT window_start, count FROM rate_limit WHERE key = ?',
    key,
  );
  return !!row && now - row.window_start < windowMs && row.count >= limit;
}
