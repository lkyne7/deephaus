import type { NextRequest } from "next/server";

/** Public origin for the current request (respects Vercel / reverse-proxy headers). */
export function requestOrigin(request: NextRequest | Request): string {
  const headers = request.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host) {
    const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? "https";
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}
