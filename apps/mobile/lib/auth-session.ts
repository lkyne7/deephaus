import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/config";

/** True when Supabase rejected a stored session refresh (simulator reinstall, revoked session, etc.). */
export function isStaleRefreshTokenError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /refresh token/i.test(message);
}

/**
 * Load the persisted session, clearing invalid local credentials instead of
 * surfacing a console error when the refresh token is gone or revoked.
 */
export async function loadStoredSession(): Promise<Session | null> {
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
