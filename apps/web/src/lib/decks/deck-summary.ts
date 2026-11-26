import type { ReviewOrderSettings, SourceType } from "@deephaus/shared";
import type { DeckPublication, SyncMode } from "@/lib/community/types";

/** Retention, new cards a day and review order: what a study settings form edits. */
export type DeckStudyValues = {
  desiredRetention: number;
  newCardsPerDay: number;
  reviewOrder?: ReviewOrderSettings;
};

/** A deck's own study settings, as the settings form starts from them. */
export type DeckSettings = DeckStudyValues & {
  useGlobalFsrsSettings?: boolean;
  fsrsParams?: number[];
};

/** What the Decks page's side panel shows beyond the list's own counts. */
export type DeckSummary = {
  id: string;
  settings: {
    desiredRetention: number;
    newCardsPerDay: number;
    hasCustomFsrsParams: boolean;
  };
  /** What the pane's Study settings view edits. */
  studySettings: {
    /** The deck's own values, with the review order in effect. */
    deck: DeckSettings;
    /** The user's defaults, for decks that follow them. */
    global: DeckStudyValues;
    /** Whether the user has optimized FSRS weights of their own. */
    hasOptimizedParams: boolean;
  };
  /** The deck's latest generation run, so an empty deck can show it running or failed. */
  job: { id: string; status: string; error: string | null; progress: number } | null;
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
  publication: DeckPublication | null;
  /** Set when this deck was added from Community. */
  subscription: { publication_id: string; sync_mode: SyncMode; my_rating: number | null } | null;
};

export function deckSummaryKey(deckId: string): string {
  return `/api/decks/${deckId}/summary`;
}
