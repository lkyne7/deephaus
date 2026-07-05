import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { runGlobalSearch } from "@/lib/search/global-search";

function clampInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/** GET /api/search?q= — unified search across decks, cards, notes, and community. */
export const GET = withApiTiming(async function GET(request: Request) {
  const { user, supabase, response } = await requireUser();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const limit = clampInt(searchParams.get("limit"), 4, 1, 8);

  if (!q) {
    return NextResponse.json({
      query: "",
      results: [],
      totals: { deck: 0, card: 0, note: 0, community: 0 },
    });
  }

  try {
    const payload = await runGlobalSearch(supabase, user!.id, q, limit);
    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "GET /api/search");
