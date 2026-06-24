import { NextResponse } from "next/server";

/** User-scoped API responses must never be reused across auth changes in a browser profile. */
export function jsonWithPrivateCache<T>(data: T): NextResponse {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Authorization, Cookie",
    },
  });
}
