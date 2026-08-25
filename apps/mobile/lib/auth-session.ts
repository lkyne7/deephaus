import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/config";

/** True when Supabase rejected a stored session refresh (simulator reinstall, revoked session, etc.). */
export function isStaleRefreshTokenError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /refresh token/i.test(message);
}

// getSession() serializes callers behind auth-js's lock and re-reads
// AsyncStorage each time, which is slow when several screens load at once.
// Keep the latest session in memory and only hit the client when the cache is
// cold or the access token is about to expire (getSession then refreshes it).
let cachedSession: Session | null = null;
let cacheHydrated = false;
let inflight: Promise<Session | null> | null = null;

supabase.auth.onAuthStateChange((_event, session) => {
  cachedSession = session;
  cacheHydrated = true;
});

const EXPIRY_MARGIN_MS = 60_000;

function isFresh(session: Session): boolean {
  if (typeof session.expires_at !== "number") return true;
  return session.expires_at * 1000 - Date.now() > EXPIRY_MARGIN_MS;
}

async function fetchStoredSession(): Promise<Session | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error && isStaleRefreshTokenError(error)) {
      await supabase.auth.signOut({ scope: "local" });
      return null;
    }
    return data.session;
  } catch (error) {
    if (isStaleRefreshTokenError(error)) {
      await supabase.auth.signOut({ scope: "local" });
      return null;
    }
    throw error;
  }
}

/**
 * Load the persisted session, clearing invalid local credentials instead of
 * surfacing a console error when the refresh token is gone or revoked.
 */
export async function loadStoredSession(): Promise<Session | null> {
  if (cacheHydrated && (cachedSession === null || isFresh(cachedSession))) {
    return cachedSession;
  }
  if (!inflight) {
    inflight = fetchStoredSession()
      .then((session) => {
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
