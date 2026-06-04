import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { loadBrowseFilters } from "@/lib/browse/cards";
import { createClient } from "@/lib/supabase/server";

/**
 * Deck + tag filter lists for the browse view. Split from `GET /api/browse/cards`
 * so the (relatively expensive) tag aggregation only runs when filters actually
 * change — not on every search keystroke or pagination step.
 */
export const GET = withApiTiming(async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const url = new URL(request.url);
  const deckId = url.searchParams.get("deck_id");

  const supabase = await createClient();

  try {
    const filters = await loadBrowseFilters(supabase, user!.id, deckId);
    return NextResponse.json({ filters });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load filters";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "GET /api/browse/filters");
