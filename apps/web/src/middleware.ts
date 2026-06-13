import { type NextRequest } from "next/server";
import { logPerf } from "@/lib/perf/logger";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  const start = performance.now();
  const response = await updateSession(request);
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
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
