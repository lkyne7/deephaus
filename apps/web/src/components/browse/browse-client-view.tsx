"use client";

import { CardBrowseView } from "@/components/card-browse-view";
import { CardsPageSkeleton } from "@/components/browse/cards-skeleton";
import { useDeckList } from "@/lib/client-cache/hooks/use-deck-list";

export function BrowseClientView() {
  const { data, isLoading } = useDeckList();

  if (!data && isLoading) {
    return <CardsPageSkeleton />;
  }

  return <CardBrowseView initialDecks={data?.decks ?? []} />;
}
