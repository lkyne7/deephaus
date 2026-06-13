import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { fetchUserProjects, type UserProjectRow } from "@/lib/data/server-auth";
import { createClient } from "@/lib/supabase/server";
import { settingsFromRecord } from "@/lib/fsrs/settings";
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
};

export type DashboardMetricsBundle = {
  projects: UserProjectRow[];
  summaries: StudyDeckSummaryRow[];
  totalCards: number;
  stateBreakdown: CardStateBreakdown;
  perDeck: DashboardDeckRow[];
};

function buildPerDeck(
  projects: UserProjectRow[],
  summaries: StudyDeckSummaryRow[],
): DashboardDeckRow[] {
  const byDeck = new Map(summaries.map((s) => [s.project_id, s]));

  return projects.map((deck) => {
    const row = byDeck.get(deck.id);
    const settings = settingsFromRecord(deck.settings);
    const newSupply = Math.max(0, settings.newCardsPerDay - (row?.new_studied_today ?? 0));
    const newAvailable = Math.min(row?.new_card_count ?? 0, newSupply);

    return {
      deck_id: deck.id,
      name: deck.deck_name || deck.name,
      due: row?.due_count ?? 0,
      new: newAvailable,
      last_reviewed: row?.last_review ?? null,
      total: row?.card_count ?? 0,
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

  const [summaries, totalCards, stateBreakdown] = await Promise.all([
    fetchStudyDeckSummaries(supabase, userId),
    countTotalUserCards(supabase, userId, deckIds),
    fetchStateBreakdown(supabase, userId, deckIds),
  ]);

  let perDeck: DashboardDeckRow[];
  if (summaries) {
    perDeck = buildPerDeck(projects, summaries);
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
