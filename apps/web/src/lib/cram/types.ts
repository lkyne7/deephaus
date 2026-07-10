import type { CardReviewRow, IntervalPreview } from "@/lib/fsrs/scheduler";

export const CRAM_PLAN_STATUSES = [
  "draft",
  "active",
  "paused",
  "completed",
  "archived",
] as const;

export type CramPlanStatus = (typeof CRAM_PLAN_STATUSES)[number];

export interface CramSelectionSpec {
  deck_ids: string[];
  source_ids: string[];
  chunk_ids: string[];
  tags: string[];
  card_ids: string[];
}

export interface CramPlanRow {
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
}

export interface CramPlanItemRow extends CardReviewRow {
  id: string;
  plan_id: string;
  card_id: string;
  project_id: string;
  cloze_ord: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CramPlanDeckProfileRow {
  plan_id: string;
  project_id: string;
  fsrs_params: number[];
}

export interface CramCardRow {
  id: string;
  project_id: string;
  source_id: string;
  source_chunk_id: string | null;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data: unknown;
  tags: string[];
  sort_order: number;
}

export interface CramReadiness {
  mean_retrievability: number;
  target_coverage: number;
  target_retention: number;
  ready_items: number;
  total_items: number;
  unseen_items: number;
}

export interface CramForecastDay {
  date: string;
  capacity: number;
  scheduled_reviews: number;
  new_reviews: number;
  total_reviews: number;
}

export interface CramForecast {
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
  readiness: CramReadiness;
  daily: CramForecastDay[];
}

export interface CramQueueCard {
  item_id: string;
  id: string;
  queue_key: string;
  cloze_ord: number | null;
  type: CramCardRow["type"];
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data: unknown;
  tags: string[];
  state: number;
  due: string;
  reps: number;
  lapses: number;
  is_new: boolean;
  intervals: IntervalPreview;
}

export interface CramTodaySummary {
  date: string;
  daily_minutes: number;
  estimated_seconds_per_review: number;
  review_capacity: number;
  reviews_completed: number;
  response_ms: number;
  minutes_spent: number;
  reviews_remaining: number;
  budget_reached: boolean;
}
