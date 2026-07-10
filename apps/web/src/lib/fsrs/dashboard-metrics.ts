import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { fetchUserProjects, type UserProjectRow } from "@/lib/data/server-auth";
import { createClient } from "@/lib/supabase/server";
import { settingsFromRecord, resolveEffectiveDeckSettings } from "@/lib/fsrs/settings";
import type { GlobalStudySettings } from "@/lib/fsrs/user-study-settings";
import { loadGlobalStudySettings } from "@/lib/fsrs/user-study-settings";
import {
  countTotalUserCards,
  fetchStateBreakdown,
  type CardStateBreakdown,
} from "@/lib/fsrs/card-counts";
import {
  fetchStudyDeckSummaries,
  type StudyDeckSummaryRow,
} from "@/lib/study/deck-summaries";
import { getStudyDeckOptions } from "@/lib/study/decks";

export type { CardStateBreakdown };

export type DashboardDeckRow = {
  deck_id: string;
  name: string;
  due: number;
  new: number;
  last_reviewed: string | null;
  total: number;
  /** Unseen (state 0) cards still in the deck — used for the progress meter. */
  new_card_count: number;
  /** True when this deck is a community publication the user subscribed to (cloned locally). */
  is_community?: boolean;
  /** True when this deck is published/shared to the community by the user. */
  is_published?: boolean;
};

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

export type DashboardMetricsBundle = {
  projects: UserProjectRow[];
  summaries: StudyDeckSummaryRow[];
  totalCards: number;
  stateBreakdown: CardStateBreakdown;
  perDeck: DashboardDeckRow[];
};

export function buildPerDeck(
  projects: UserProjectRow[],
  summaries: StudyDeckSummaryRow[],
  global?: GlobalStudySettings,
  communityIds?: Set<string>,
  publishedIds?: Set<string>,
): DashboardDeckRow[] {
  const byDeck = new Map(summaries.map((s) => [s.project_id, s]));

  return projects.map((deck) => {
    const row = byDeck.get(deck.id);
    const settings = resolveEffectiveDeckSettings(settingsFromRecord(deck.settings), global);
    const newSupply = Math.max(0, settings.newCardsPerDay - (row?.new_studied_today ?? 0));
    const newAvailable = Math.min(row?.new_card_count ?? 0, newSupply);

    return {
      deck_id: deck.id,
      name: deck.deck_name || deck.name,
      due: row?.due_count ?? 0,
      new: newAvailable,
      last_reviewed: row?.last_review ?? null,
      total: row?.card_count ?? 0,
      new_card_count: row?.new_card_count ?? 0,
      is_community: communityIds?.has(deck.id) ?? false,
      is_published: publishedIds?.has(deck.id) ?? false,
    };
  });
}

export function totalsFromPerDeck(perDeck: DashboardDeckRow[]) {
  let dueNow = 0;
  let newTodayRemaining = 0;
  for (const deck of perDeck) {
    dueNow += deck.due;
    newTodayRemaining += deck.new;
  }
  return { dueNow, newTodayRemaining };
}

export async function loadDashboardMetricsBundle(
  supabase: SupabaseClient,
  userId: string,
): Promise<DashboardMetricsBundle> {
  const projects = await fetchUserProjects(supabase, userId);
  const deckIds = projects.map((p) => p.id);

  const [summaries, totalCards, stateBreakdown, global, communityIds, publishedIds] =
    await Promise.all([
      fetchStudyDeckSummaries(supabase, userId),
      countTotalUserCards(supabase, userId, deckIds),
      fetchStateBreakdown(supabase, userId, deckIds),
      loadGlobalStudySettings(supabase, userId),
      fetchCommunitySubscriptionIds(supabase, userId),
      fetchPublishedProjectIds(supabase, userId),
    ]);

  let perDeck: DashboardDeckRow[];
  if (summaries) {
    perDeck = buildPerDeck(projects, summaries, global, communityIds, publishedIds);
  } else {
    const options = await getStudyDeckOptions(supabase, userId, projects);
    const optionsById = new Map(options.map((o) => [o.id, o]));
    perDeck = projects.map((deck) => ({
      deck_id: deck.id,
      name: deck.deck_name || deck.name,
      due: optionsById.get(deck.id)?.due ?? 0,
      new: optionsById.get(deck.id)?.new ?? 0,
      last_reviewed: null,
      total: 0,
      new_card_count: 0,
      is_community: communityIds.has(deck.id),
      is_published: publishedIds.has(deck.id),
    }));
  }

  return {
    projects,
    summaries: summaries ?? [],
    totalCards,
    stateBreakdown,
    perDeck,
  };
}

/** Per-request memo — safe inside RSC (uses cookie auth). */
export const loadDashboardMetricsBundleForRequest = cache(
  async (userId: string): Promise<DashboardMetricsBundle> => {
    const supabase = await createClient();
    return loadDashboardMetricsBundle(supabase, userId);
  },
);
