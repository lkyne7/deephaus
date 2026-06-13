"use client";

import useSWR from "swr";
import { cacheKeys } from "@/lib/client-cache/keys";
import type { CommunityDeckRow } from "@/lib/community/types";

export function useCommunityDecks() {
  return useSWR<CommunityDeckRow[]>(cacheKeys.communityDecks);
}
