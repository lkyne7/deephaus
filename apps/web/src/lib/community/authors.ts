import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

/**
 * Usernames of deck publishers, by user id.
 *
 * Profiles are readable by their owner only, so this goes through a
 * service-role function that returns the username and nothing else (the
 * leaderboard does the same). Any failure, including the function not existing
 * yet, just means no author is shown.
 */
export async function loadPublisherNames(publisherIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(publisherIds)];
  if (ids.length === 0) return new Map();
  try {
    const { data, error } = await createServiceClient().rpc("get_publication_authors", {
      p_publisher_ids: ids,
    });
    if (error || !Array.isArray(data)) return new Map();
    return new Map(
      (data as Array<{ user_id: string; username: string }>).map((row) => [row.user_id, row.username]),
    );
  } catch {
    return new Map();
  }
}
