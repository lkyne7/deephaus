"use client";

import useSWR from "swr";
import { cacheKeys } from "@/lib/client-cache/keys";
import type { StudyDeckOption } from "@/lib/study/decks";

export function useStudyDecks(fallbackData?: { decks: StudyDeckOption[] }) {
  return useSWR<{ decks: StudyDeckOption[] }>(
    cacheKeys.studyDecks,
    fallbackData
      ? {
          fallbackData,
          // Server already prefetched — refresh in the background without blocking paint.
          revalidateOnMount: false,
        }
      : undefined,
  );
}
