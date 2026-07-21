"use client";

import useSWR from "swr";
import { leaderboardKey } from "@/lib/client-cache/keys";
import type { LeaderboardData, LeaderboardPeriod } from "@/lib/stats/leaderboard";

export function useLeaderboard(period: LeaderboardPeriod, enabled = true) {
  return useSWR<LeaderboardData>(enabled ? leaderboardKey(period) : null);
}
