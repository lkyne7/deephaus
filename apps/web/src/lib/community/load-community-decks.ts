import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPublisherNames } from "@/lib/community/authors";
import type { CommunityDeckRow, SyncMode } from "@/lib/community/types";

export function pickDashboardCommunityDecks(decks: CommunityDeckRow[], limit = 4): CommunityDeckRow[] {
  return [...decks]
    .filter((d) => !d.is_owner)
    .sort((a, b) => {
      if (a.is_subscribed !== b.is_subscribed) return a.is_subscribed ? 1 : -1;
      return b.subscriber_count - a.subscriber_count || b.card_count - a.card_count;
    })
    .slice(0, limit);
}

export async function loadCommunityDecks(
  supabase: SupabaseClient,
  userId: string,
): Promise<CommunityDeckRow[]> {
  const { data: publications, error } = await supabase
    .from("deck_publications")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!publications?.length) return [];

  const publicationIds = publications.map((p) => p.id as string);

  const [{ data: subscriptions }, { data: ratings }, authors] = await Promise.all([
    supabase
      .from("deck_subscriptions")
      .select("publication_id, sync_mode, local_project_id")
      .eq("subscriber_id", userId),
    supabase
      .from("publication_ratings")
      .select("publication_id, stars")
      .eq("user_id", userId)
      .in("publication_id", publicationIds),
    loadPublisherNames(publications.map((p) => p.publisher_id as string)),
  ]);

  const subByPub = new Map(
    (subscriptions ?? []).map((s) => [
      s.publication_id,
      {
        sync_mode: s.sync_mode as SyncMode,
        local_project_id: s.local_project_id as string,
      },
    ]),
  );

  const ratingByPub = new Map(
    (ratings ?? []).map((r) => [r.publication_id as string, Number(r.stars)]),
  );

  return publications.map((p) => {
    const sub = subByPub.get(p.id);
    return {
      ...(p as CommunityDeckRow),
      avg_rating: Number(p.avg_rating ?? 0),
      rating_count: Number(p.rating_count ?? 0),
      is_subscribed: sub != null,
      subscription_sync_mode: sub?.sync_mode ?? null,
      local_project_id: sub?.local_project_id ?? null,
      is_owner: p.publisher_id === userId,
      my_rating: ratingByPub.get(p.id) ?? null,
      author: authors.get(p.publisher_id as string) ?? null,
    };
  });
}
