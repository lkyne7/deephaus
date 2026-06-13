"use client";

import useSWR from "swr";
import { cacheKeys } from "@/lib/client-cache/keys";

export function useDeckList() {
  return useSWR<{ decks: Array<{ id: string; name: string }> }>(cacheKeys.deckList);
}
