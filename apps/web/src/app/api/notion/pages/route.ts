import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { notionErrorResponse } from "@/lib/notion/api-errors";
import { searchNotionPages } from "@/lib/notion/pages";

/** GET /api/notion/pages?query=&cursor= — search the user's shared Notion pages. */
export const GET = withApiTiming(async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query") ?? undefined;
  const cursor = searchParams.get("cursor") ?? undefined;

  try {
    const result = await searchNotionPages(user!.id, query, cursor);
    return NextResponse.json(result);
  } catch (error) {
    const mapped = notionErrorResponse(error);
    if (mapped) return mapped;
    const message = error instanceof Error ? error.message : "Notion search failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}, "GET /api/notion/pages");
