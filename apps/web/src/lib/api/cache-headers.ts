import { NextResponse } from "next/server";

/** Private short-lived cache for per-user API responses (pairs with client SWR). */
export function jsonWithPrivateCache<T>(data: T, maxAgeSeconds = 30): NextResponse {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": `private, max-age=${maxAgeSeconds}, stale-while-revalidate=120`,
    },
  });
}

/** Always-fresh JSON for mutation-sensitive lists (dashboard decks, study hub). */
export function jsonNoStore<T>(data: T): NextResponse {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}
