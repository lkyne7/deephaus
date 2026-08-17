"use client";

import { useSearchParams } from "next/navigation";
import { CommunityView } from "@/components/community-view";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { OfflineNotice } from "@/components/offline-gate";
import { CommunityGridSkeleton } from "@/components/ui/skeleton-patterns";
import { useCommunityDecks } from "@/lib/client-cache/hooks/use-community-decks";
import { useOnline } from "@/lib/offline/use-online";

export function CommunityClientView() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const online = useOnline();
  const { data: decks, isLoading, error, mutate } = useCommunityDecks();

  if (!online && !decks) {
    return <OfflineNotice feature="Community decks" />;
  }

  if (!decks && isLoading) {
    return <CommunityGridSkeleton />;
  }

  // A failed fetch must not masquerade as "no community decks yet".
  if (!decks && error) {
    return <LoadErrorState label="community decks" onRetry={() => void mutate()} />;
  }

  return <CommunityView initialDecks={decks ?? []} initialQuery={initialQuery} />;
}
