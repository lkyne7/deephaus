"use client";

import { CommunityView } from "@/components/community-view";
import { CommunityGridSkeleton } from "@/components/ui/skeleton-patterns";
import { useCommunityDecks } from "@/lib/client-cache/hooks/use-community-decks";

export function CommunityClientView() {
  const { data: decks, isLoading } = useCommunityDecks();

  if (!decks && isLoading) {
    return <CommunityGridSkeleton />;
  }

  return <CommunityView initialDecks={decks ?? []} />;
}
