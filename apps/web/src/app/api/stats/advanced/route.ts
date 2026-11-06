import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { requirePlan } from "@/lib/billing/access";
import { createClient } from "@/lib/supabase/server";
import {
  ADVANCED_STATS_RANGES,
  DeckNotFoundError,
  getAdvancedStats,
} from "@/lib/fsrs/advanced-stats";

/** GET /api/stats/advanced?deck=<uuid|all>&range=<7|30|365> */
export const GET = withApiTiming(async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const upgrade = await requirePlan(user!.id, "plus", "Advanced analytics");
  if (upgrade) return upgrade;

  const url = new URL(request.url);
  const deckParam = url.searchParams.get("deck");
  const deckId = !deckParam || deckParam === "all" ? null : deckParam;
  const range = ADVANCED_STATS_RANGES.find(
    (days) => days === Number(url.searchParams.get("range")),
  );

  const supabase = await createClient();
  try {
    const stats = await getAdvancedStats(supabase, user!.id, deckId, range);
    return NextResponse.json(stats);
  } catch (err) {
    if (err instanceof DeckNotFoundError) {
      return NextResponse.json({ error: "Deck not found" }, { status: 404 });
    }
    throw err;
  }
}, "GET /api/stats/advanced");
