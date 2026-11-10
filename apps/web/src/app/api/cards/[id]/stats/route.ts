import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireAuth } from "@/lib/auth";
import { loadCardStats } from "@/lib/cards/card-stats";

/** GET /api/cards/{id}/stats: when the card is next due, its reviews and its last grade. */
export const GET = withApiTiming(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  const { id } = await params;
  const stats = await loadCardStats(supabase, user!.id, id);
  if (!stats) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  return NextResponse.json(stats);
}, "GET /api/cards/[id]/stats");
