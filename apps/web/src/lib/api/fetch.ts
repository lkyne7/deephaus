import { tryLocalApi } from "@/lib/offline/local-api";
import { createClient } from "@/lib/supabase/client";

/**
 * Browser fetch to app API routes with session cookies and Supabase access token.
 * Route handlers validate via `requireUser()` (cookies or Bearer).
 *
 * When offline-first mode is configured (NEXT_PUBLIC_POWERSYNC_URL), core
 * study/cram/browse/dashboard routes are served from the local PowerSync
 * replica instead of the network.
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
  return fetch(input, {
    ...init,
    cache: "no-store",
    credentials: "include",
    headers,
  });
}
