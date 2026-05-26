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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
