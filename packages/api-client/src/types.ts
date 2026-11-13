import type { EasyDays, ReviewContext, ReviewOrderSettings } from "@deephaus/shared";
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
  is_community?: boolean;
  is_published?: boolean;
  /** Paused decks are skipped by the combined review. */
  paused?: boolean;
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
  offline_media_deferred?: number;
  deck: { id: string; name: string; settings?: GenerationSettings };
  cards: ReviewCardPayload[];
  day_start_hour?: number;
  counts: {
    due: number;
    new: number;
    learning: number;
    total: number;
    new_today_remaining?: number;
    /** New cards that exist but were excluded by today's daily limit. */
    new_held_back?: number;
    new_per_day_limit?: number;
  };
};

export type SubmitReviewBody = (
  | { grade: ReviewGrade; cloze_ord?: number }
  | { rating: 1 | 2 | 3 | 4; cloze_ord?: number }
) & {
  /** Stable UUID reused when an ambiguous network request is retried. */
  client_mutation_id?: string;
  answered_at?: string;
  raw_answered_at?: string;
  /** Where the card was answered. Omitted means ordinary study. */
  context?: ReviewContext;
  /** The exam this review counted towards, when `context` is "exam". */
  exam_id?: string | null;
  /** Time from the card being shown to the grade, in ms (0 to 3,600,000). */
  response_ms?: number | null;
};

export type ReviewReconciliationMetadata = {
  review_id?: string;
  reconciliation?: "authoritative" | "history_only";
  raw_answered_at?: string;
  answered_at?: string;
  received_at?: string;
  clock_adjusted?: boolean;
  winning_review_id?: string | null;
};
export type SubmitReviewResponse = ReviewReconciliationMetadata & Record<string, unknown>;

export type ReviewRestoreBody = {
  log_id?: string;
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

/** `POST /api/browse/batch`: one action on up to 500 of the user's cards. */
export type BrowseBatchRequest =
  | { action: "suspend" | "unsuspend" | "delete"; card_ids: string[] }
  /** Move the cards into another deck. Their review history goes with them. */
  | { action: "move"; card_ids: string[]; deck_id: string }
  /** Add one tag to the cards, or take it off them. */
  | { action: "tag" | "untag"; card_ids: string[]; tag: string };

export type BrowseBatchResponse = {
  /** Cards the action changed. */
  updated: number;
  suspended?: boolean;
  /** `move` only. */
  moved?: number;
  already_there?: number;
  /** `move` only: cards left in place because their images belong to their source. */
  kept_for_images?: number;
  /** `tag` and `untag` only: the tag as it was stored. */
  tag?: string;
};

/** `GET /api/cards/{id}/stats` */
export type CardStats = {
  reps: number;
  due: string | null;
  /** 1 Again, 2 Hard, 3 Good, 4 Easy. */
  last_rating: number | null;
  last_reviewed: string | null;
};

export type CardUpdateBody = Partial<
  Pick<
    DraftCard,
    | "front"
    | "back"
    | "extra"
    | "cloze_text"
    | "tags"
    | "source_chunk_id"
    | "source_ref"
    | "source_quote"
  >
> & {
  type?: "basic" | "cloze" | "image-occlusion";
  occlusion_data?: ImageOcclusionData | null;
};

export type CreateCardBody = {
  project_id: string;
  type?: "basic" | "cloze" | "image-occlusion";
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
  tags?: string[];
  source_chunk_id?: string | null;
  source_ref?: string | null;
  source_quote?: string | null;
  occlusion_data?: unknown;
  append?: boolean;
};

export type DashboardStats = {
  reviewed_today: number;
  cards_learned_today: number;
  retention_pct: number | null;
  streak: number;
  due_now: number;
  new_today_remaining: number;
  total_cards: number;
  state_breakdown: {
    new: number;
    learning: number;
    review: number;
    relearning: number;
  };
  per_deck: Array<{
    deck_id: string;
    name: string;
    due: number;
    new: number;
    last_reviewed: string | null;
    total: number;
    /** Unseen cards still in the deck. */
    new_card_count?: number;
    is_community?: boolean;
    is_published?: boolean;
    /** Paused decks keep their counts but are left out of the totals. */
    paused?: boolean;
  }>;
  last_optimized_at: string | null;
  fsrs_log_count: number;
  /** Served by a separate endpoint; omitted from the consolidated stats payload. */
  heatmap?: ReviewHeatmapData;
};

export type ReviewHeatmapData = {
  year: number;
  /** Completed reviews per day (past + today). */
  counts: Record<string, number>;
  /** Cards scheduled due per day (tomorrow onward). */
  forecast?: Record<string, number>;
};

export type UserProfile = {
  user_id: string;
  username: string;
  full_name: string;
  avatar_url: string | null;
  university_name: string | null;
  university_domain: string | null;
  university_email: string | null;
  university_email_verified_at: string | null;
};

export type UpdateProfileBody = Partial<{
  username: string;
  full_name: string;
  university_id: string | null;
}>;

export type UniversityOption = {
  id: string;
  name: string;
  country: string;
  country_code: string;
  domains: string[];
};

export type UniversitySearchResponse = {
  universities: UniversityOption[];
};

export type UniversityVerificationSendResponse = {
  ok: true;
  university_id: string | null;
  university_name: string;
  email: string;
  expires_in_seconds: number;
};

export type UniversityVerificationResponse = {
  ok: true;
  profile: UserProfile;
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
  rating_distribution: {
    again: number;
    hard: number;
    good: number;
    easy: number;
  };
  maturity: {
    new: number;
    learning: number;
    young: number;
    mature: number;
    suspended: number;
  };
  state_breakdown: {
    new: number;
    learning: number;
    review: number;
    relearning: number;
  };
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
  avg_rating?: number;
  rating_count?: number;
  published_at: string;
  updated_at: string;
  /** One of the Community subjects, or null when the publisher chose none. */
  subject?: string | null;
  /** When the cards last changed; `updated_at` also moves on adds and ratings. */
  content_updated_at?: string | null;
  /** The publisher's username, when it could be looked up. */
  author?: string | null;
  /** The deck is in the user's own decks. */
  is_subscribed?: boolean;
  subscription_sync_mode?: SyncMode | null;
  local_project_id?: string | null;
  is_owner?: boolean;
  my_rating?: number | null;
};

export type CommunityDeckCard = {
  id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  /** Image-occlusion regions; null for other card types. */
  occlusion_data?: unknown;
  tags: string[];
};

export type CommunityDeckDetail = {
  publication: CommunityDeckRow;
  /** One page of the deck's cards, in deck order. */
  previewCards: CommunityDeckCard[];
  /** Cards per type and the most used tags. First page only; null on older servers. */
  facts?: { types: Record<string, number>; tags: string[] } | null;
  is_subscribed: boolean;
  subscription_sync_mode: SyncMode | null;
  local_project_id?: string | null;
  my_rating?: number | null;
};

export type CommunityDeckRatingResponse = {
  my_rating: number | null;
  avg_rating: number;
  rating_count: number;
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

export type StartGenerationResponse = {
  job: GenerationJob;
  cards: DraftCard[];
};

export type AnkiImportResponse = {
  decks: Array<{ id: string; name: string; cardCount: number }>;
  cardsImported: number;
  scheduledImported: number;
  suspendedImported: number;
  /** Absent from servers that predate review-history import. */
  reviewLogsImported?: number;
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

export type PrepareAnkiImportResponse = {
  bucket: string;
  storagePath: string;
  importId: string;
  maxApkgBytes: number;
};

export type AnkiImportJobResponse = {
  id: string;
  status: "pending" | "processing" | "ready" | "failed";
  phase: string | null;
  progress: number;
  error: string | null;
  result: AnkiImportResponse | null;
  filename: string | null;
};

export type SourceExtractionJobResponse = {
  id: string;
  source_id: string;
  status: "pending" | "processing" | "ready" | "failed";
  phase: string;
  progress: number;
  pages_total: number | null;
  pages_completed: number;
  generation_job_id: string | null;
  error: string | null;
};

export type EnqueueAnkiExportResponse = {
  jobId: string;
  /** True when the deck is small enough to package inside the request's after() hook. */
  inline: boolean;
  filename: string;
};

export type AnkiExportResult = {
  bytes: number;
  cardCount: number;
  skipped: number;
  mediaBundled: number;
  mediaSkipped: number;
  scheduledExported: number;
  suspendedExported: number;
  reviewLogsExported: number;
};

export type AnkiExportJobResponse = {
  id: string;
  status: "pending" | "processing" | "ready" | "failed" | "expired";
  phase: string | null;
  progress: number;
  error: string | null;
  result: AnkiExportResult | null;
  filename: string;
  file_size: number | null;
  expires_at: string | null;
};

export type AnkiExportDownloadResponse = {
  /** Signed storage URL; downloading it needs no DeepHaus credentials. */
  url: string;
  filename: string;
  size: number | null;
  urlExpiresAt: string;
};

export type CardSpeechRequest = {
  /** Card text; media tags, cloze markers and markup are removed before synthesis. */
  text: string;
  voice?: string;
  /** Language name or code, for native pronunciation. */
  language?: string;
  /** Label shown on the clip; defaults to "Pronunciation". */
  title?: string;
};

export type CardSpeechResponse = {
  url: string;
  path: string;
  title: string;
  characters: number;
  credits: number;
};

export type QuizletSkippedRow = {
  /** 1-based line in the pasted text where the row starts. */
  line: number;
  reason: "missing_term" | "missing_definition";
};

export type QuizletImportResponse = Omit<AnkiImportResponse, "source"> & {
  /** Rows left out because they lacked a term or definition. */
  skippedRows?: QuizletSkippedRow[];
};

/** Body of the 422 returned when rows are incomplete and skipping wasn't confirmed. */
export type QuizletIncompleteRowsError = {
  error: string;
  code: "incomplete_rows";
  cardsFound: number;
  skippedRows: QuizletSkippedRow[];
};

export type {
  CardExplainKind,
  CardExplainState,
  CardExplanationBody,
  CardFieldFix,
  ExplainSuggestion,
  ExplainThreadMessage,
} from "@deephaus/shared";

export type ApplyExplainSuggestionResponse = {
  state: import("@deephaus/shared").CardExplainState;
  /** The card's new text after a fix was applied. */
  card?: { id: string; front: string | null; back: string | null; cloze_text: string | null; extra: string | null };
  /** Set when a suggested card was added. */
  created_card_id?: string;
};

export type AutoDetectOcclusionResponse = {
  occlusion_data: ImageOcclusionData;
  type: "image-occlusion";
};

export type FsrsOptimizeResponse = Record<string, unknown>;

export type FsrsSettingsResponse = {
  easyDays?: EasyDays;
  timezone?: string | null;
  desiredRetention: number;
  newCardsPerDay: number;
  dayStartHour?: number;
  /** Review order and limits every deck follows unless it sets its own. */
  reviewOrder?: ReviewOrderSettings;
  hasOptimizedParams?: boolean;
  lastOptimizedAt?: string | null;
  fsrsLogCount?: number;
};

export type UpdateFsrsSettingsBody = Partial<{
  easyDays: EasyDays;
  timezone: string | null;
  desiredRetention: number;
  newCardsPerDay: number;
  dayStartHour: number;
  reviewOrder: Partial<ReviewOrderSettings>;
}>;

export type DeckOverview = Record<string, unknown>;
export type DeckStats = Record<string, unknown>;

/** Partial study-settings patch merged server-side into `projects.settings`. */
export type DeckSettingsPatch = Partial<{
  desiredRetention: number;
  newCardsPerDay: number;
  useGlobalFsrsSettings: boolean;
  clearFsrsParams: boolean;
  /** A paused deck keeps its cards but is left out of today's totals and the combined review. */
  paused: boolean;
  spaceOutSiblings: boolean;
  newCardPosition: ReviewOrderSettings["newCardPosition"];
  reviewSortOrder: ReviewOrderSettings["reviewSortOrder"];
  /** Null removes the deck's review cap. */
  maxReviewsPerDay: number | null;
}>;

export type UpdateDeckBody = Partial<{
  name: string;
  deck_name: string;
  settings: DeckSettingsPatch;
}>;

export type BillingPlanKey = "basic" | "plus" | "pro";

export type BillingAccountStatus =
  | "inactive"
  | "trialing"
  | "active"
  | "grace_period"
  | "billing_issue"
  | "expired";

export type BillingFeatureGates = {
  manualStudy: boolean;
  fsrsScheduling: boolean;
  aiGeneration: boolean;
  cloudSources: boolean;
  automaticOcclusion: boolean;
  advancedAnalytics: boolean;
  videoTranscription: boolean;
  mcpAccess: boolean;
  priorityProcessing: boolean;
};

export type BillingStatus = {
  plan: BillingPlanKey;
  planName: string;
  status: BillingAccountStatus;
  isActive: boolean;
  priority: 0 | 1 | 2;
  source: string | null;
  productId: string | null;
  entitlementIds: string[];
  expiresAt: string | null;
  willRenew: boolean;
  environment: "sandbox" | "production";
  credits: {
    periodStart: string;
    periodEnd: string;
    allowance: number;
    used: number;
    reserved: number;
    remaining: number;
  };
  features: BillingFeatureGates;
};

export type LeaderboardPeriod = "week" | "month" | "all";

export type LeaderboardEntry = {
  rank: number;
  username: string;
  reviews: number;
  isMe: boolean;
};

export type LeaderboardData = {
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  /** Caller's own standing; null when they have no reviews in the period. */
  me: { rank: number; reviews: number } | null;
};

export type GlobalSearchKind = "deck" | "card" | "community";

export type GlobalSearchHit = {
  kind: GlobalSearchKind;
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  cardType?: "basic" | "cloze" | "image-occlusion";
  sourceType?: string;
};

export type GlobalSearchResponse = {
  query: string;
  results: GlobalSearchHit[];
  totals: Record<GlobalSearchKind, number>;
};

export type TopicSuggestion = {
  id: string;
  label: string;
  query: string;
};

export type TopicSuggestionsResponse = { suggestions: TopicSuggestion[] };

export type {
  CreateExamBody,
  ExamAction,
  ExamCardReason,
  ExamDeckBreakdownDto,
  ExamDetailDto,
  ExamInsightDto,
  ExamListResponse,
  ExamPlanDayDto,
  ExamPlanDto,
  ExamQueueCard,
  ExamQueueResponse,
  ExamReadyDeckDto,
  ExamScorePointDto,
  ExamSelectionSpec,
  ExamSelectorDeck,
  ExamSelectorOptions,
  ExamSelectorSource,
  ExamSelectorTag,
  ExamSnapshotDto,
  ExamStageName,
  ExamStatus,
  ExamSummaryDto,
  PreviewExamBody,
  UpdateExamBody,
} from "@deephaus/shared";

export type AiCreditsExhaustedResponse = {
  error: string;
  code: "AI_CREDITS_EXHAUSTED";
  allowance: number;
  consumed: number;
  required: number;
  remaining: number;
};

export type PlanUpgradeRequiredResponse = {
  error: string;
  code: "PLAN_UPGRADE_REQUIRED";
  currentPlan: BillingPlanKey;
  requiredPlan: Exclude<BillingPlanKey, "basic">;
  feature: string;
};
