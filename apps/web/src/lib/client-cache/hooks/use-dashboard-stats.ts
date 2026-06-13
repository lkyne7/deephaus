"use client";

import useSWR from "swr";
import { cacheKeys } from "@/lib/client-cache/keys";
import type { DashboardStats } from "@/lib/fsrs/stats";

export function useDashboardStats() {
  return useSWR<DashboardStats>(cacheKeys.dashboardStats);
}
