import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { jsonNoStore } from "@/lib/api/cache-headers";
import { requireAuth } from "@/lib/auth";
import { getCachedStudyDecks } from "@/lib/study/cached-study-decks";

/** Deck list with accurate due/new counts for the study hub and in-session deck switcher. */
export const GET = withApiTiming(async function GET() {
  const { user, response } = await requireAuth();
  if (response) return response;

  try {
    const decks = await getCachedStudyDecks(user!.id);
    return jsonNoStore({ decks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load study decks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "GET /api/study/decks");
