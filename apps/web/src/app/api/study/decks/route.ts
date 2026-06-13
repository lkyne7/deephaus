import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { jsonWithPrivateCache } from "@/lib/api/cache-headers";
import { requireUser } from "@/lib/auth";
import { getCachedStudyDecks } from "@/lib/study/cached-study-decks";

/** Deck list with accurate due/new counts for the study hub and in-session deck switcher. */
export const GET = withApiTiming(async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const decks = await getCachedStudyDecks(user!.id);
    return jsonWithPrivateCache({ decks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load study decks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "GET /api/study/decks");
