import type { Session } from "@supabase/supabase-js";
import {
  supabase,
  authStorage,
  SUPABASE_URL,
  loadOfflineIdentity,
  clearOfflineIdentity,
} from "@/lib/config";
import { getCachedNetworkState } from "./network-state";

/** True when Supabase rejected a stored session refresh (simulator reinstall, revoked session, etc.). */
export function isStaleRefreshTokenError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /refresh token/i.test(message);
}

// getSession() serializes callers behind auth-js's lock and re-reads
// AsyncStorage each time, which is slow when several screens load at once.
// Keep the latest session in memory and only hit the client when the cache is
// cold or the access token is about to expire (getSession then refreshes it).
let cachedSession: Session | null = null;
let cacheHydrated = false;
let inflight: Promise<Session | null> | null = null;
let explicitSignOut = false;
let sessionRevision = 0;
export async function prepareExplicitSignOut() {
  explicitSignOut = true;
  sessionRevision++;
  cachedSession = null;
  cacheHydrated = true;
  await clearOfflineIdentity();
}
export function cancelExplicitSignOut() {
  explicitSignOut = false;
  cacheHydrated = false;
}

supabase.auth.onAuthStateChange((event, session) => {
  sessionRevision++;
  if (event === "SIGNED_IN") explicitSignOut = false;
  if (explicitSignOut && session) return;
  cachedSession = session;
  cacheHydrated = !!session || explicitSignOut;
});

const EXPIRY_MARGIN_MS = 60_000;

function isFresh(session: Session): boolean {
  if (typeof session.expires_at !== "number") return true;
  return session.expires_at * 1000 - Date.now() > EXPIRY_MARGIN_MS;
}

async function fetchStoredSession(): Promise<Session | null> {
  const network = await getCachedNetworkState();
  if (network.isConnected === false || network.isInternetReachable === false) {
    // Local identity unlocks this account's replica; it is never server authorization.
    if (cachedSession) return cachedSession;
    const key = `sb-${new URL(SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
    const raw = await authStorage.getItem(key);
    if (raw) {
      const stored = JSON.parse(raw) as Session;
      if (stored.user?.id) return stored;
    }
    return explicitSignOut ? null : loadOfflineIdentity();
  }
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error && isStaleRefreshTokenError(error)) {
      return explicitSignOut ? null : loadOfflineIdentity();
    }
    return (
      data.session ?? (explicitSignOut ? null : await loadOfflineIdentity())
    );
  } catch (error) {
    if (isStaleRefreshTokenError(error)) {
      return explicitSignOut ? null : loadOfflineIdentity();
    }
    const local = explicitSignOut ? null : await loadOfflineIdentity();
    if (local) return local;
    throw error;
  }
}

/**
 * Load server credentials when available, otherwise select the saved local
 * account without credentials. Only explicit sign-out clears local identity.
 */
export async function loadStoredSession(): Promise<Session | null> {
  if (explicitSignOut) return null;
  if (
    cacheHydrated &&
    cachedSession &&
    (!cachedSession.access_token || isFresh(cachedSession))
  ) {
    return cachedSession;
  }
  if (!inflight) {
    const revision = sessionRevision;
    inflight = fetchStoredSession()
      .then((session) => {
        if (explicitSignOut) return null;
        if (revision !== sessionRevision && cachedSession) return cachedSession;
        cachedSession = session;
        cacheHydrated = true;
        return session;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
