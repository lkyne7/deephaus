"use client";

import { useSearchParams } from "next/navigation";
import { CommunityView } from "@/components/community-view";
import { OfflineNotice } from "@/components/offline-gate";
import { CommunityGridSkeleton } from "@/components/ui/skeleton-patterns";
import { useCommunityDecks } from "@/lib/client-cache/hooks/use-community-decks";
import { useOnline } from "@/lib/offline/use-online";

export function CommunityClientView() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";
  const online = useOnline();
  const { data: decks, isLoading } = useCommunityDecks();

  if (!online && !decks) {
    return <OfflineNotice feature="Community decks" />;
  }

  if (!decks && isLoading) {
    return <CommunityGridSkeleton />;
  }

  return <CommunityView initialDecks={decks ?? []} initialQuery={initialQuery} />;
}
