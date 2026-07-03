import "server-only";
import { NextResponse } from "next/server";
import { NotionAuthError, NotionNotConnectedError } from "./client";

/**
 * Map Notion connection errors to API responses. `code` lets clients offer a
 * "Connect Notion" / "Reconnect" action instead of a generic failure.
 */
export function notionErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof NotionNotConnectedError) {
    return NextResponse.json({ error: error.message, code: "not_connected" }, { status: 409 });
  }
  if (error instanceof NotionAuthError) {
    return NextResponse.json({ error: error.message, code: "reconnect" }, { status: 409 });
  }
  return null;
}
