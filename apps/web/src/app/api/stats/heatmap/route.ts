import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { jsonWithPrivateCache } from "@/lib/api/cache-headers";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getReviewHeatmap } from "@/lib/fsrs/stats";

/** GET /api/stats/heatmap?year=2026 */
export const GET = withApiTiming(async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const url = new URL(request.url);
  const yearParam = url.searchParams.get("year");
  const year = yearParam ? Number.parseInt(yearParam, 10) : new Date().getFullYear();
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  const supabase = await createClient();
  const heatmap = await getReviewHeatmap(supabase, user!.id, year);
  return jsonWithPrivateCache(heatmap);
}, "GET /api/stats/heatmap");
