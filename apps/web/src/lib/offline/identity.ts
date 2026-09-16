"use client";
// This identifier only selects a local replica. It is never a server credential.
const KEY = "deephaus:offline-owner";
export function rememberOfflineUser(userId: string) {
  try {
    localStorage.setItem(KEY, userId);
  } catch {
    /* Storage failures are shown by offline readiness. */
  }
}
export function getOfflineUserId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function clearOfflineUser() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* The database is still cleared by explicit sign-out. */
  }
}
