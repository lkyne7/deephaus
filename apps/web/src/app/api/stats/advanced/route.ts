import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DeckNotFoundError, getAdvancedStats } from "@/lib/fsrs/advanced-stats";

/** GET /api/stats/advanced?deck=<uuid|all> */
export const GET = withApiTiming(async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const url = new URL(request.url);
  const deckParam = url.searchParams.get("deck");
  const deckId = !deckParam || deckParam === "all" ? null : deckParam;

  const supabase = await createClient();
  try {
    const stats = await getAdvancedStats(supabase, user!.id, deckId);
    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof DeckNotFoundError) {
      return NextResponse.json({ error: "Deck not found" }, { status: 404 });
    }
    throw err;
  }
}, "GET /api/stats/advanced");
