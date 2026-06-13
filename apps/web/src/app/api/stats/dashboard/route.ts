import { withApiTiming } from "@/lib/perf/with-api-timing";
import { jsonWithPrivateCache } from "@/lib/api/cache-headers";
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
  return jsonWithPrivateCache(stats);
}, "GET /api/stats/dashboard");
