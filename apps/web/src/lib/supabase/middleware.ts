import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthNetworkError, shouldClearStaleSession } from "@/lib/auth-errors";

function clearSupabaseAuthCookies(request: NextRequest, response: NextResponse) {
  for (const { name } of request.cookies.getAll()) {
    if (name.startsWith("sb-")) {
      response.cookies.delete(name);
    }
  }
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  try {
    const { error } = await supabase.auth.getUser();

    // Stale or revoked refresh tokens leave orphan auth cookies that spam errors
    // locally. Only clear cookies when auth explicitly rejected the session —
    // never on network outages, which would log users out during blips and add
    // another slow Supabase round-trip via signOut().
    if (shouldClearStaleSession(error)) {
      clearSupabaseAuthCookies(request, supabaseResponse);
    } else if (error && isAuthNetworkError(error)) {
      console.warn("[auth middleware] Supabase unreachable; keeping existing session cookies");
    }
  } catch (err) {
    if (isAuthNetworkError(err as { message?: string })) {
      console.warn("[auth middleware] Supabase unreachable; skipping session refresh");
    } else {
      console.error("[auth middleware]", err);
    }
  }

  return supabaseResponse;
}
