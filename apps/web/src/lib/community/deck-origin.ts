import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Project IDs that are local clones of community decks the user subscribed to.
 * `deck_subscriptions.local_project_id` is the authoritative marker.
 */
export async function fetchCommunitySubscriptionIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("deck_subscriptions")
    .select("local_project_id")
    .eq("subscriber_id", userId);

  if (error || !data) return new Set();
  return new Set(
    (data as Array<{ local_project_id: string | null }>)
      .map((r) => r.local_project_id)
      .filter((id): id is string => Boolean(id)),
  );
}

/**
 * Project IDs the user has published to the community. A row in
 * `deck_publications` (removed on unpublish) is the authoritative marker.
 */
export async function fetchPublishedProjectIds(
  supabase: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("deck_publications")
    .select("source_project_id")
    .eq("publisher_id", userId);

  if (error || !data) return new Set();
  return new Set(
    (data as Array<{ source_project_id: string | null }>)
      .map((r) => r.source_project_id)
      .filter((id): id is string => Boolean(id)),
  );
}
