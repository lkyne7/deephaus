import type {
  DraftCard,
  GenerationJob,
  GenerationSettings,
  ImageOcclusionData,
  Project,
  Source,
} from "@deephaus/shared";

export type ReviewGrade = "again" | "hard" | "good" | "easy";
export type SyncMode = "follow" | "fork";

export type StudyDeckOption = {
  id: string;
  title: string;
  due: number;
  new: number;
  waiting: number;
};

export type StudyDecksResponse = { decks: StudyDeckOption[] };

export type ReviewCardPayload = {
  id: string;
  queue_key: string;
  cloze_ord: number | null;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
  tags: string[];
  state: number;
  due: string;
  reps: number;
  lapses: number;
  is_new: boolean;
  intervals: Record<ReviewGrade, string>;
};

export type StudyQueueResponse = {
  deck: { id: string; name: string; settings?: GenerationSettings };
  cards: ReviewCardPayload[];
  counts: {
    due: number;
    new: number;
    learning: number;
    total: number;
    new_today_remaining?: number;
  };
};

export type SubmitReviewBody =
  | { grade: ReviewGrade; cloze_ord?: number }
  | { rating: 1 | 2 | 3 | 4; cloze_ord?: number };

export type SubmitReviewResponse = Record<string, unknown>;

export type ReviewRestoreBody = {
  cloze_ord?: number;
  review_state?: Record<string, unknown> | null;
  log_action?: "delete_latest" | "insert";
  log?: Record<string, unknown>;
};

export type ReviewRestoreResponse = Record<string, unknown>;

export type BrowseCardRow = {
  id: string;
  deck_id: string;
  deck_name: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
  tags: string[];
  sort_order: number;
  user_edited: boolean;
  suspended: boolean;
};

export type BrowseFilters = {
  decks: Array<{ id: string; name: string }>;
  tags: string[];
};

export type BrowseCardsResponse = {
  cards: BrowseCardRow[];
  total: number;
  limit: number;
  offset: number;
  filters?: BrowseFilters | null;
};

export type CardUpdateBody = Partial<
  Pick<DraftCard, "front" | "back" | "extra" | "cloze_text" | "tags">
> & {
  type?: "basic" | "cloze" | "image-occlusion";
  occlusion_data?: ImageOcclusionData | null;
};

export type DashboardStats = {
  reviewed_today: number;
  cards_learned_today: number;
  retention_pct: number | null;
  streak: number;
  due_now: number;
  new_today_remaining: number;
  total_cards: number;
  state_breakdown: { new: number; learning: number; review: number; relearning: number };
  per_deck: Array<{
    deck_id: string;
    name: string;
    due: number;
    new: number;
    last_reviewed: string | null;
    total: number;
  }>;
  last_optimized_at: string | null;
  fsrs_log_count: number;
  heatmap: ReviewHeatmapData;
};

export type ReviewHeatmapData = {
  year: number;
  counts: Record<string, number>;
};

export type AdvancedStatsDayCount = { date: string; count: number };

export type AdvancedStats = {
  scope: { deck_id: string | null; deck_name: string | null };
  total_cards: number;
  total_reviews: number;
  reviews_30d: number;
  retention_30d: number | null;
  retention_window_days: number;
  rating_window_days: number;
  mature_cards: number;
  avg_stability: number | null;
  avg_difficulty: number | null;
  streak: number;
  rating_distribution: { again: number; hard: number; good: number; easy: number };
  maturity: { new: number; learning: number; young: number; mature: number; suspended: number };
  state_breakdown: { new: number; learning: number; review: number; relearning: number };
  reviews_per_day: AdvancedStatsDayCount[];
  due_forecast: AdvancedStatsDayCount[];
  per_deck: Array<{
    deck_id: string;
    name: string;
    total_cards: number;
    due: number;
    mature: number;
    reviews_90d: number;
    retention_90d: number | null;
  }>;
};

export type CommunityDeckRow = {
  id: string;
  publisher_id: string;
  source_project_id: string;
  title: string;
  description: string | null;
  version: number;
  card_count: number;
  subscriber_count: number;
  published_at: string;
  updated_at: string;
  is_subscribed?: boolean;
  subscription_sync_mode?: SyncMode | null;
  is_owner?: boolean;
};

export type CommunityDeckDetail = {
  publication: CommunityDeckRow;
  previewCards: Array<{
    id: string;
    type: "basic" | "cloze";
    front: string | null;
    back: string | null;
    cloze_text: string | null;
    extra: string | null;
    tags: string[];
  }>;
  is_subscribed: boolean;
  subscription_sync_mode: SyncMode | null;
};

export type SubscribeDeckResponse = {
  localProjectId: string;
  subscription?: unknown;
};

export type GenerateTextResponse = {
  source: Source;
  job: GenerationJob;
  cards: DraftCard[];
  mock?: boolean;
};

export type StartGenerationResponse = { job: GenerationJob; cards: DraftCard[] };

export type AnkiImportResponse = {
  decks: Array<{ id: string; name: string; cardCount: number }>;
  cardsImported: number;
  scheduledImported: number;
  suspendedImported: number;
  mediaImported: number;
  mediaSkipped: number;
  fsrsPresetsApplied: number;
  source: {
    deckCount: number;
    noteCount: number;
    cardCount: number;
    scheduledCount: number;
    suspendedCount: number;
    mediaCount: number;
    fsrsPresetCount: number;
  };
};

export type ExplainCardResponse = { explanation: string };

export type AutoDetectOcclusionResponse = {
  occlusion_data: ImageOcclusionData;
  type: "image-occlusion";
};

export type FsrsOptimizeResponse = Record<string, unknown>;

export type DeckOverview = Record<string, unknown>;
export type DeckStats = Record<string, unknown>;
export type UpdateDeckBody = Partial<{ name: string; deck_name: string; settings: GenerationSettings }>;
