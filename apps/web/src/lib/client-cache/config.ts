"use client";

import type { SWRConfiguration } from "swr";
import { swrFetcher } from "@/lib/client-cache/fetcher";

/**
 * Shared SWR defaults — stale-while-revalidate like Notion/Linear:
 * show cached data instantly on tab switch, refresh quietly in the background.
 */
export const appSwrConfig: SWRConfiguration = {
  fetcher: swrFetcher,
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 60_000,
  keepPreviousData: true,
  errorRetryCount: 2,
  // Revalidate in the background every 5 minutes while the app stays open.
  refreshInterval: 5 * 60_000,
  onError: (err, key) => {
    console.warn(`[swr] ${String(key)}:`, err);
  },
};
