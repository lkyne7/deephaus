import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildTopicSuggestions,
  topicQueryFromSourceRow,
  type TopicSuggestion,
  type TopicSuggestionDeck,
} from "@deephaus/shared";

type SourceRow = { type: string; raw_text: string | null };
type SubscriptionRow = {
  deck_publications: { title: string } | { title: string }[] | null;
};

function publicationTitle(
  row: SubscriptionRow["deck_publications"],
): string | null {
  if (!row) return null;
  const pub = Array.isArray(row) ? row[0] : row;
  const title = pub?.title?.trim();
  return title || null;
}

function deckOrigin(
  sources: SourceRow[],
  hasCommunitySubscription: boolean,
): TopicSuggestionDeck["origin"] | null {
  if (hasCommunitySubscription) return "community";
  if (sources.some((s) => s.type === "apkg")) return "imported";
  if (
    sources.some(
      (s) =>
        s.type !== "topic" &&
        !(s.type === "text" && s.raw_text?.startsWith("[[deephaus:topic]]")),
    )
  ) {
    return "generated";
  }
  return null;
}

export async function loadTopicSuggestions(
  supabase: SupabaseClient,
  userId: string,
): Promise<TopicSuggestion[]> {
  const [topicSourcesRes, projectsRes, subscriptionsRes] = await Promise.all([
    supabase
      .from("sources")
      .select("raw_text, type, created_at, projects!inner(user_id)")
      .eq("projects.user_id", userId)
      .or("type.eq.topic,raw_text.like.[[deephaus:topic]]%")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("projects")
      .select("id, deck_name, name, updated_at, sources(type, raw_text)")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(60),
    supabase
      .from("deck_subscriptions")
      .select(
        "local_project_id, subscribed_at, deck_publications(title)",
      )
      .eq("subscriber_id", userId)
      .order("subscribed_at", { ascending: false })
      .limit(40),
  ]);

  if (topicSourcesRes.error) throw new Error(topicSourcesRes.error.message);
  if (projectsRes.error) throw new Error(projectsRes.error.message);
  if (subscriptionsRes.error) throw new Error(subscriptionsRes.error.message);

  const communityByProject = new Map<string, { title: string; at: string }>();
  for (const sub of subscriptionsRes.data ?? []) {
    const title = publicationTitle(sub.deck_publications);
    if (!title || !sub.local_project_id) continue;
    communityByProject.set(sub.local_project_id, {
      title,
      at: sub.subscribed_at,
    });
  }

  const topicQueries: string[] = [];
  for (const source of topicSourcesRes.data ?? []) {
    const query = topicQueryFromSourceRow(source);
    if (query) topicQueries.push(query);
  }

  const decks: TopicSuggestionDeck[] = [];
  for (const project of projectsRes.data ?? []) {
    const sources = (project.sources ?? []) as SourceRow[];
    const community = communityByProject.get(project.id);
    const origin = deckOrigin(sources, Boolean(community));
    if (!origin) continue;

    const name = (community?.title ?? project.deck_name ?? project.name ?? "").trim();
    if (!name) continue;

    decks.push({
      name,
      updatedAt: community?.at ?? project.updated_at,
      origin,
    });
  }

  return buildTopicSuggestions({ topicQueries, decks });
}
