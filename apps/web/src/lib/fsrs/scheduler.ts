import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  Rating,
  State,
  default_w,
  type Card as FsrsCard,
  type FSRS,
  type Grade as FsrsGrade,
  type RecordLog,
} from "ts-fsrs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_DESIRED_RETENTION } from "@deephaus/shared";

export const FSRS_PARAM_COUNT = default_w.length;

interface SchedulerOptions {
  w?: number[];
  requestRetention?: number;
}

/**
 * Build an FSRS instance for one request. ts-fsrs is cheap to instantiate,
 * so we make a fresh one per call rather than caching globally — this lets
 * each user / deck use its own fitted params + retention target.
 *
 * `enable_fuzz` is on so a batch of newly-graded cards don't all bunch up to
 * the exact same review minute.
 */
export function buildScheduler(opts: SchedulerOptions = {}): FSRS {
  return fsrs(
    generatorParameters({
      enable_fuzz: true,
      ...(opts.w ? { w: opts.w as number[] } : {}),
      ...(opts.requestRetention !== undefined ? { request_retention: opts.requestRetention } : {}),
    }),
  );
}

const PARAMS_CACHE_TTL_MS = 60_000;
const paramsCache = new Map<string, { value: number[] | undefined; expiresAt: number }>();

/**
 * Load the user's personalized FSRS weights, falling back to ts-fsrs defaults
 * when no optimization has run yet. Validates the param length so a future
 * algorithm version doesn't silently feed wrongly-shaped weights into FSRS.
 */
export async function loadUserParams(
  supabase: SupabaseClient,
  userId: string,
): Promise<number[] | undefined> {
  const cached = paramsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const { data } = await supabase
    .from("user_fsrs_params")
    .select("params")
    .eq("user_id", userId)
    .maybeSingle();
  const params = data?.params as number[] | undefined;
  const value =
    !params || params.length !== FSRS_PARAM_COUNT ? undefined : params;
  paramsCache.set(userId, { value, expiresAt: Date.now() + PARAMS_CACHE_TTL_MS });
  return value;
}

/** Database row shape for public.card_reviews (subset used here). */
export interface CardReviewRow {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
  learning_steps: number;
}

/** Convert a stored review row into a ts-fsrs Card object. */
export function rowToCard(row: CardReviewRow): FsrsCard {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps ?? 0,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as State,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

/** Card columns ready to be upserted into public.card_reviews. */
export function cardToRowFields(card: FsrsCard) {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps ?? 0,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as number,
    last_review: card.last_review ? card.last_review.toISOString() : null,
  };
}

export type GradeLabel = "again" | "hard" | "good" | "easy";

const RATING_BY_GRADE: Record<GradeLabel, FsrsGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function gradeToRating(grade: GradeLabel): FsrsGrade {
  return RATING_BY_GRADE[grade];
}

export function isValidGrade(rating: number): rating is FsrsGrade {
  return rating === 1 || rating === 2 || rating === 3 || rating === 4;
}

/** Human-readable interval label for grade buttons. */
export function formatInterval(scheduledDays: number): string {
  if (scheduledDays < 1 / 1440) return "< 1m";
  if (scheduledDays < 1 / 24) {
    const minutes = Math.max(1, Math.round(scheduledDays * 1440));
    return `${minutes}m`;
  }
  if (scheduledDays < 1) {
    const hours = Math.max(1, Math.round(scheduledDays * 24));
    return `${hours}h`;
  }
  if (scheduledDays < 30) {
    return `${Math.round(scheduledDays)}d`;
  }
  if (scheduledDays < 365) {
    return `${Math.round(scheduledDays / 30)}mo`;
  }
  return `${(scheduledDays / 365).toFixed(1)}y`;
}

export interface IntervalPreview {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

export function previewIntervals(
  scheduler: FSRS,
  card: FsrsCard,
  now: Date = new Date(),
): IntervalPreview {
  const log: RecordLog = scheduler.repeat(card, now);
  return {
    again: formatInterval(log[Rating.Again].card.scheduled_days),
    hard: formatInterval(log[Rating.Hard].card.scheduled_days),
    good: formatInterval(log[Rating.Good].card.scheduled_days),
    easy: formatInterval(log[Rating.Easy].card.scheduled_days),
  };
}

export function emptyCard(now: Date = new Date()): FsrsCard {
  return createEmptyCard(now);
}

export { Rating, State, DEFAULT_DESIRED_RETENTION };
export type { FsrsGrade };
