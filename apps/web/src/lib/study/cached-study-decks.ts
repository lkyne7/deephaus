import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";
import { canUseServiceClient } from "@/lib/cache/stats-client";
import { getUserStudyCacheEpoch } from "@/lib/cache/study-cache-epoch";
import { studyDecksTag } from "@/lib/cache/tags";
import { fetchUserProjects } from "@/lib/data/server-auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getStudyDeckOptions, type StudyDeckOption } from "@/lib/study/decks";

const STUDY_DECKS_TTL_SECONDS = 30;

const getStudyDecksForRequest = cache(async (userId: string): Promise<StudyDeckOption[]> => {
  const supabase = await createClient();
  const projects = await fetchUserProjects(supabase, userId);
  return getStudyDeckOptions(supabase, userId, projects);
});

/** Cross-request cache for study hub deck counts; cookie auth fallback in local dev. */
export async function getCachedStudyDecks(userId: string): Promise<StudyDeckOption[]> {
  if (!canUseServiceClient()) {
    return getStudyDecksForRequest(userId);
  }

  const epoch = getUserStudyCacheEpoch(userId);
  return unstable_cache(
    async () => {
      const supabase = createServiceClient();
      const projects = await fetchUserProjects(supabase, userId);
      return getStudyDeckOptions(supabase, userId, projects);
    },
    ["study-decks", userId, String(epoch)],
    {
      revalidate: STUDY_DECKS_TTL_SECONDS,
      tags: [studyDecksTag(userId)],
    },
  )();
}
