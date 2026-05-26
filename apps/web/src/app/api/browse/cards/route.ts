import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { loadBrowseCards, loadBrowseFilters } from "@/lib/browse/cards";
import { createClient } from "@/lib/supabase/server";

export const GET = withApiTiming(async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const url = new URL(request.url);
  const deckId = url.searchParams.get("deck_id");
  const tag = url.searchParams.get("tag");
  const search = url.searchParams.get("q");
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);
  const offset = clampInt(url.searchParams.get("offset"), 0, 0, 100_000);
  const includeFilters = url.searchParams.get("filters") === "1";

  const supabase = await createClient();

  try {
    const [result, filters] = await Promise.all([
      loadBrowseCards(supabase, user!.id, {
        deckId,
        tag,
        search,
        limit,
        offset,
      }),
      includeFilters
        ? loadBrowseFilters(supabase, user!.id, deckId)
        : Promise.resolve(null),
    ]);

    return NextResponse.json({ ...result, filters });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load cards";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "GET /api/browse/cards");

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
