import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  getDashboardOverviewStats,
  getDashboardStats,
  type DashboardOverviewStats,
  type DashboardStats,
} from "@/lib/fsrs/stats";

/**
 * Per-request memoization for dashboard stats. Uses React `cache()` (not
 * `unstable_cache`) because `createClient()` reads auth from `headers()`, which
 * cannot run inside a cross-request cache scope.
 */
export const getCachedDashboardStats = cache(async (userId: string): Promise<DashboardStats> => {
  const supabase = await createClient();
  return getDashboardStats(supabase, userId);
});

export const getCachedDashboardOverviewStats = cache(
  async (userId: string): Promise<DashboardOverviewStats> => {
    const supabase = await createClient();
    return getDashboardOverviewStats(supabase, userId);
  },
);
