import { NextResponse, type NextRequest } from "next/server";
import { CONSENT_REGION_COOKIE, countryNeedsConsent } from "@/lib/consent";
import { logPerf } from "@/lib/perf/logger";
import { settingsRedirectFromQuery } from "@/lib/settings/tabs";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const settingsTarget = settingsRedirectFromQuery(request.nextUrl.searchParams);
  if (settingsTarget) return NextResponse.redirect(new URL(settingsTarget, request.nextUrl));

  const start = performance.now();
  const response = await updateSession(request);
  // Vercel sets the visitor's country; DEEPHAUS_CONSENT_COUNTRY stands in for
  // it locally. The cookie only says "ask for analytics consent".
  const country = request.headers.get("x-vercel-ip-country") ?? process.env.DEEPHAUS_CONSENT_COUNTRY;
  if (countryNeedsConsent(country)) {
    response.cookies.set(CONSENT_REGION_COOKIE, "1", { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
  } else if (country && request.cookies.has(CONSENT_REGION_COOKIE)) {
    response.cookies.delete(CONSENT_REGION_COOKIE);
  }
  logPerf({
    kind: "middleware",
    path: request.nextUrl.pathname,
    method: request.method,
    durationMs: Math.round(performance.now() - start),
    runtime: "edge",
  });
  return response;
}

export const config = {
  matcher: [
    // Skip /api: route handlers authenticate themselves via requireUser(), and
    // the browser attaches a fresh Bearer token to every API call. Running the
    // session-refresh middleware there too just doubled the Supabase auth
    // round-trip on every request.
    // PowerSync's worker imports several public JS/WASM assets in sequence.
    // Running remote auth refresh for each one adds seconds to local DB startup.
    "/((?!api|_next/static|_next/image|@powersync|sw\\.js|manifest\\.webmanifest|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
