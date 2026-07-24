import "server-only";

/**
 * Per-user epoch for study/dashboard `unstable_cache` keys.
 * Bumping forces a cache miss on the next read (same server instance).
 */
const userEpoch = new Map<string, number>();

export function getUserStudyCacheEpoch(userId: string): number {
  return userEpoch.get(userId) ?? 0;
}

export function bumpUserStudyCacheEpoch(userId: string): number {
  const next = getUserStudyCacheEpoch(userId) + 1;
  userEpoch.set(userId, next);
  return next;
}
