import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { canUseServiceClient } from "@/lib/cache/stats-client";
import { dashboardStatsTag } from "@/lib/cache/tags";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  getDashboardOverviewStats,
  getDashboardStats,
  type DashboardOverviewStats,
  type DashboardStats,
} from "@/lib/fsrs/stats";

const DASHBOARD_STATS_TTL_SECONDS = 30;

const getDashboardStatsForRequest = cache(async (userId: string): Promise<DashboardStats> => {
  const supabase = await createClient();
  return getDashboardStats(supabase, userId);
});

const getDashboardOverviewStatsForRequest = cache(
  async (userId: string): Promise<DashboardOverviewStats> => {
    const supabase = await createClient();
    return getDashboardOverviewStats(supabase, userId);
  },
);

/**
 * Cross-request TTL cache for dashboard stats when the service role key is set.
 * Falls back to per-request cookie auth in local dev (no service role in .env.local).
 */
export async function getCachedDashboardStats(userId: string): Promise<DashboardStats> {
  if (!canUseServiceClient()) {
    return getDashboardStatsForRequest(userId);
  }

  return unstable_cache(
    async () => {
      const supabase = createServiceClient();
      return getDashboardStats(supabase, userId);
    },
    ["dashboard-stats", userId],
    {
      revalidate: DASHBOARD_STATS_TTL_SECONDS,
      tags: [dashboardStatsTag(userId)],
    },
  )();
}

export async function getCachedDashboardOverviewStats(
  userId: string,
): Promise<DashboardOverviewStats> {
  if (!canUseServiceClient()) {
    return getDashboardOverviewStatsForRequest(userId);
  }

  return unstable_cache(
    async () => {
      const supabase = createServiceClient();
      return getDashboardOverviewStats(supabase, userId);
    },
    ["dashboard-overview-stats", userId],
    {
      revalidate: DASHBOARD_STATS_TTL_SECONDS,
      tags: [dashboardStatsTag(userId)],
    },
  )();
}
