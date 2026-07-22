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
  avg_rating?: number;
  rating_count?: number;
  published_at: string;
  updated_at: string;
  is_subscribed?: boolean;
  subscription_sync_mode?: SyncMode | null;
  local_project_id?: string | null;
  is_owner?: boolean;
  my_rating?: number | null;
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

export type QuizletImportResponse = Omit<AnkiImportResponse, "source">;

export type ExplainCardResponse = { explanation: string };

export type AutoDetectOcclusionResponse = {
  occlusion_data: ImageOcclusionData;
  type: "image-occlusion";
};

export type FsrsOptimizeResponse = Record<string, unknown>;

export type FsrsSettingsResponse = {
  desiredRetention: number;
  newCardsPerDay: number;
  hasOptimizedParams?: boolean;
  lastOptimizedAt?: string | null;
  fsrsLogCount?: number;
};

export type UpdateFsrsSettingsBody = Partial<{
  desiredRetention: number;
  newCardsPerDay: number;
}>;

export type DeckOverview = Record<string, unknown>;
export type DeckStats = Record<string, unknown>;
export type UpdateDeckBody = Partial<{ name: string; deck_name: string; settings: GenerationSettings }>;

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

export type GlobalSearchKind = "deck" | "card" | "note" | "community";

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

export type CramPlanStatus = "draft" | "active" | "paused" | "completed" | "archived";

export type CramSelectionSpec = {
  deck_ids: string[];
  source_ids: string[];
  chunk_ids: string[];
  tags: string[];
  card_ids: string[];
};

export type CramReadinessDetail = {
  mean_retrievability: number;
  target_coverage: number;
  target_retention: number;
  ready_items: number;
  total_items: number;
  unseen_items: number;
};

export type CramPlanSummary = {
  id: string;
  user_id: string;
  name: string;
  status: CramPlanStatus;
  deadline_at: string;
  deadline_timezone: string;
  deadline_has_time: boolean;
  target_retention: number;
  daily_minutes: number;
  selection_spec: CramSelectionSpec;
  estimated_seconds_per_review: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  item_count: number;
  card_count: number;
  readiness: number;
  readiness_score: number;
  target_coverage: number;
  counts: { total: number; new: number; reviewed: number };
};

export type CramForecastDay = {
  date: string;
  capacity: number;
  scheduled_reviews: number;
  new_reviews: number;
  total_reviews: number;
};

export type CramForecast = {
  generated_at: string;
  deadline_at: string;
  days_remaining: number;
  item_count: number;
  new_count: number;
  due_count: number;
  estimated_seconds_per_review: number;
  daily_review_capacity: number;
  total_review_capacity: number;
  estimated_reviews: number;
  estimated_minutes: number;
  feasible: boolean;
  readiness: number;
  readiness_score: number;
  readiness_detail: CramReadinessDetail;
  target_coverage: number;
  total_cards: number;
  cards_selected: number;
  cards_due_today: number;
  reviews_per_day: number;
  estimated_daily_minutes: number;
  daily: CramForecastDay[];
};

export type CramPlanListItem = CramPlanSummary & { forecast: CramForecast };

export type CramPlanItemPreview = {
  id: string;
  item_id: string;
  card_id: string;
  cloze_ord: number | null;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  deck_name: string | null;
  tags: string[];
};

export type CramPlanDetail = {
  plan: CramPlanSummary;
  forecast: CramForecast;
  items_preview: CramPlanItemPreview[];
};

export type CramTodaySummary = {
  date: string;
  daily_minutes: number;
  estimated_seconds_per_review: number;
  review_capacity: number;
  reviews_completed: number;
  response_ms: number;
  minutes_spent: number;
  reviews_remaining: number;
  budget_reached: boolean;
};

export type CramQueueCard = {
  item_id: string;
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

export type CramQueueResponse = {
  plan: CramPlanSummary;
  cards: CramQueueCard[];
  counts: {
    total: number;
    queued: number;
    due: number;
    new: number;
    remaining: number;
  };
  readiness: CramReadinessDetail;
  readiness_score: number;
  today: CramTodaySummary;
  daily_budget: number;
  reviewed_today: number;
  remaining_today: number;
  budget_reached: boolean;
};

export type CramReviewResponse = {
  item_id: string;
  version: number;
  intervals: Record<ReviewGrade, string>;
  today: CramTodaySummary;
} & Record<string, unknown>;

export type CramSelectorDeck = { id: string; name: string; card_count: number; count: number };
export type CramSelectorSource = {
  id: string;
  name: string;
  label: string;
  deck_id: string;
  deck_name: string | null;
  type: string;
  card_count: number;
  count: number;
};
export type CramSelectorTag = { tag: string; count: number };

export type CramSelectorOptions = {
  options: {
    decks: CramSelectorDeck[];
    sources: CramSelectorSource[];
    tags: CramSelectorTag[];
  };
};

export type CreateCramPlanBody = {
  name: string;
  deadline_at: string;
  deadline_timezone?: string;
  deadline_has_time?: boolean;
  target_retention?: number;
  daily_minutes: number;
  deck_ids?: string[];
  source_ids?: string[];
  tags?: string[];
};

export type UpdateCramPlanBody = Partial<CreateCramPlanBody>;

export type CramPlanAction =
  | "start"
  | "pause"
  | "resume"
  | "complete"
  | "archive"
  | "unarchive";

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
