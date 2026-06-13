"use client";

import { useMemo } from "react";
import { StudyHubView } from "@/components/study-hub-view";
import { DecksSectionSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { useStudyDecks } from "@/lib/client-cache/hooks/use-study-decks";
import { deckRowsFromPerDeck } from "@/lib/fsrs/dashboard-decks";
import type { DashboardDeckRow } from "@/lib/fsrs/dashboard-metrics";
import type { StudyDeckOption } from "@/lib/study/decks";

function studyDecksToGridRows(
  decks: Array<{ id: string; title: string; due: number; new: number; waiting: number }>,
): ReturnType<typeof deckRowsFromPerDeck> {
  const perDeck: DashboardDeckRow[] = decks.map((d) => ({
    deck_id: d.id,
    name: d.title,
    due: d.due,
    new: d.new,
    last_reviewed: null,
    total: 0,
  }));
  return deckRowsFromPerDeck(perDeck).sort(
    (a, b) => b.dueCount + b.newCount - (a.dueCount + a.newCount),
  );
}

type Props = {
  /** Server-prefetched deck queue counts for instant first paint. */
  initialDecks?: StudyDeckOption[];
  /** Deck cards link into the reviewer instead of deck settings. */
  studyEntry?: boolean;
};

export function StudyClientView({ initialDecks, studyEntry = false }: Props) {
  const { data: studyData, isLoading } = useStudyDecks(
    initialDecks ? { decks: initialDecks } : undefined,
  );

  const deckOptions = useMemo(() => {
    if (studyData?.decks) return studyData.decks;
    return initialDecks ?? [];
  }, [studyData?.decks, initialDecks]);

  const showSkeleton = deckOptions.length === 0 && isLoading && !initialDecks?.length;

  if (showSkeleton) {
    return <DecksSectionSkeleton />;
  }

  const decks = studyDecksToGridRows(deckOptions);
  return <StudyHubView decks={decks} studyEntry={studyEntry} />;
}
