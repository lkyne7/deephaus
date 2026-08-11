import { tryLocalApi } from "@/lib/offline/local-api";
import { createClient } from "@/lib/supabase/client";

/**
 * Browser fetch to app API routes with session cookies and Supabase access token.
 * Route handlers validate via `requireUser()` (cookies or Bearer).
 *
 * Online reads use the server as the authoritative source while local writes
 * continue to queue through PowerSync. Offline reads, or reads whose network
 * request actually fails, fall back to the local replica.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const local = await tryLocalApi(input, init);
  if (local) return local;

  const headers = new Headers(init?.headers);
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${session.access_token}`);
    }
  } catch {
    // Session lookup is best-effort; cookies may still authenticate the request.
  }
  try {
    return await fetch(input, {
      ...init,
      cache: "no-store",
      credentials: "include",
      headers,
    });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    const fallback = await tryLocalApi(input, init, true);
    if (fallback) return fallback;
    throw error;
  }
}
