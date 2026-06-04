import { createClient } from "@/lib/supabase/client";

/**
 * Browser fetch to app API routes with session cookies and Supabase access token.
 * Route handlers validate via `requireUser()` (cookies or Bearer).
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${session.access_token}`);
  }
  return fetch(input, {
    ...init,
    credentials: "include",
    headers,
  });
}
