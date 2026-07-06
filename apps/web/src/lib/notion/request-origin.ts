import type { NextRequest } from "next/server";

function isLocalHost(host: string): boolean {
  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".local");
}

/** Public origin for the current request (respects Vercel / reverse-proxy headers). */
export function requestOrigin(request: NextRequest | Request): string {
  const url = new URL(request.url);
  const headers = request.headers;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");

  if (host) {
    const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (forwardedProto) return `${forwardedProto}://${host}`;

    // Direct local requests have no forwarded proto — use the actual URL scheme.
    if (host === url.host) return url.origin;

    return `${isLocalHost(host) ? "http" : "https"}://${host}`;
  }

  return url.origin;
}

/** Whether the incoming request arrived over HTTPS (for OAuth cookies). */
export function requestIsSecure(request: NextRequest | Request): boolean {
  return new URL(request.url).protocol === "https:";
}
