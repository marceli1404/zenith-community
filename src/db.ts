/**
 * Thin D1 helpers. We keep raw SQL (no ORM) for a small, auditable surface, but
 * centralise id generation, timestamps, and the common query shapes here so call
 * sites stay terse and consistent.
 */

/** URL-safe unique id (nanoid-style, 21 chars). Uses the runtime CSPRNG. */
export function newId(prefix?: string): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-";
  const bytes = new Uint8Array(21);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b & 63];
  return prefix ? `${prefix}_${out}` : out;
}

export function now(): number {
  return Date.now();
}

/** Run a query returning the first row or null. */
export async function first<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  return (await stmt.first<T>()) ?? null;
}

/** Run a query returning all rows. */
export async function all<T>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  const res = await stmt.all<T>();
  return res.results ?? [];
}

/** Execute a write statement. */
export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  return stmt.run();
}

/** Execute several statements atomically via D1 batch. */
export async function batch(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements);
}
