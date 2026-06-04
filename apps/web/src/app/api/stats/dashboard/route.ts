import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { getCachedDashboardStats } from "@/lib/fsrs/cached-stats";

/**
 *   GET /api/stats/dashboard
 *
 * Aggregated review stats for the current user used by the dashboard's stat
 * cards (today's reviews, current streak, retention %, due-now totals, etc.).
 */
export const GET = withApiTiming(async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;
  const stats = await getCachedDashboardStats(user!.id);
  return NextResponse.json(stats);
}, "GET /api/stats/dashboard");
