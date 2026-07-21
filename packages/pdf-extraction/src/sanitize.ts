/**
 * PostgreSQL rejects U+0000 (NUL) in text/jsonb. PDF text extractors
 * (especially math / CID fonts in arXiv papers) sometimes emit real NULs;
 * JSON.stringify turns those into `\u0000`, and PostgREST fails with
 * "unsupported Unicode escape sequence".
 */
export function stripNullBytes(value: string): string {
  return value.replace(/\u0000/g, "");
}

/** Deep-sanitize strings in JSON-like values before writing to Postgres. */
export function sanitizeForPostgres<T>(value: T): T {
  if (typeof value === "string") {
    return stripNullBytes(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForPostgres(item)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitizeForPostgres(entry),
      ]),
    ) as T;
  }
  return value;
}
