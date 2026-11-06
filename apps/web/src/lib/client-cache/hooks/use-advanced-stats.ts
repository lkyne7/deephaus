"use client";

import useSWR from "swr";
import { apiFetch } from "@/lib/api/fetch";
import { advancedStatsKey } from "@/lib/client-cache/keys";
import type { AdvancedStats } from "@/lib/fsrs/advanced-stats";

/** Carries the status so a plan gate can be told apart from a failed load. */
export class AdvancedStatsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchAdvancedStats(url: string): Promise<AdvancedStats> {
  const res = await apiFetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new AdvancedStatsError(body?.error ?? "Could not load statistics", res.status);
  }
  return (await res.json()) as AdvancedStats;
}

export function useAdvancedStats(deck: string, range: number, enabled: boolean) {
  return useSWR<AdvancedStats, Error>(
    enabled ? advancedStatsKey(deck, range) : null,
    fetchAdvancedStats,
    {
      shouldRetryOnError: (error) => !(error instanceof AdvancedStatsError && error.status === 402),
    },
  );
}
