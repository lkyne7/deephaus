import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { jsonWithPrivateCache } from "@/lib/api/cache-headers";
import { requireUser } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  LEADERBOARD_PERIODS,
  buildLeaderboard,
  periodStartFor,
  type LeaderboardPeriod,
  type LeaderboardRpcRow,
} from "@/lib/stats/leaderboard";

const MAX_ROWS = 25;

/** GET /api/stats/leaderboard?period=week|month|all */
export const GET = withApiTiming(async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const url = new URL(request.url);
  const period = (url.searchParams.get("period") ?? "week") as LeaderboardPeriod;
  if (!LEADERBOARD_PERIODS.includes(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  // Ranking spans every user, which RLS (correctly) forbids for the session
  // client — go through the service role and let buildLeaderboard strip
  // anything private before it leaves the server.
  const service = createServiceClient();
  const { data, error } = await service.rpc("get_review_leaderboard", {
    period_start: periodStartFor(period)?.toISOString() ?? null,
    max_rows: MAX_ROWS,
    include_user_id: user!.id,
  });

  if (error) {
    console.error("Leaderboard query failed:", error.message);
    return NextResponse.json({ error: "Failed to load leaderboard" }, { status: 500 });
  }

  return jsonWithPrivateCache(
    buildLeaderboard((data ?? []) as LeaderboardRpcRow[], user!.id, period, MAX_ROWS),
  );
}, "GET /api/stats/leaderboard");
