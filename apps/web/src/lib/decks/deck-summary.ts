import type { SourceType } from "@deephaus/shared";
import type { SyncMode } from "@/lib/community/types";

/** What the Decks page's side panel shows beyond the list's own counts. */
export type DeckSummary = {
  id: string;
  settings: {
    desiredRetention: number;
    newCardsPerDay: number;
    hasCustomFsrsParams: boolean;
  };
  sampleCards: Array<{
    id: string;
    type: "basic" | "cloze" | "image-occlusion";
    front: string | null;
    back: string | null;
    cloze_text: string | null;
    extra: string | null;
  }>;
  sources: Array<{ id: string; type: SourceType; title: string; cardCount: number }>;
  /** Set when the user has published this deck to Community. */
  publication: { id: string; title: string; subscriber_count: number } | null;
  /** Set when this deck was added from Community. */
  subscription: { publication_id: string; sync_mode: SyncMode; my_rating: number | null } | null;
};

export function deckSummaryKey(deckId: string): string {
  return `/api/decks/${deckId}/summary`;
}
