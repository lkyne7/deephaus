/**
 * Best-effort in-memory fixed-window rate limiter for personal access tokens.
 *
 * Per-instance only: on serverless each warm instance keeps its own counters,
 * so the effective global limit scales with concurrency. This is a guard rail
 * against runaway MCP clients, not a billing-grade quota.
 */

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 120;
const MAX_TRACKED_TOKENS = 10_000;

type Window = { start: number; count: number };

const windows = new Map<string, Window>();

export type RateLimitResult =
  | { limited: false }
  | { limited: true; retryAfterSeconds: number };

export function checkPatRateLimit(tokenId: string): RateLimitResult {
  const now = Date.now();
  const current = windows.get(tokenId);

  if (!current || now - current.start >= WINDOW_MS) {
    if (windows.size >= MAX_TRACKED_TOKENS) pruneExpired(now);
    windows.set(tokenId, { start: now, count: 1 });
    return { limited: false };
  }

  current.count += 1;
  if (current.count > MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.start + WINDOW_MS - now) / 1000));
    return { limited: true, retryAfterSeconds };
  }
  return { limited: false };
}

function pruneExpired(now: number) {
  for (const [key, value] of windows) {
    if (now - value.start >= WINDOW_MS) windows.delete(key);
  }
  // Pathological case: everything is inside the current window. Drop it all
  // rather than let the map grow without bound.
  if (windows.size >= MAX_TRACKED_TOKENS) windows.clear();
}
