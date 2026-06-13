"use client";

import { CardBrowseView } from "@/components/card-browse-view";
import { BrowsePageSkeleton } from "@/components/ui/skeleton-patterns";
import { useDeckList } from "@/lib/client-cache/hooks/use-deck-list";

export function BrowseClientView() {
  const { data, isLoading } = useDeckList();

  if (!data && isLoading) {
    return <BrowsePageSkeleton />;
  }

  return <CardBrowseView initialDecks={data?.decks ?? []} />;
}
