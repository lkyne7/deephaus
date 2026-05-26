import {
  fsrs,
  generatorParameters,
  createEmptyCard,
  Rating,
  State,
  type Card as FsrsCard,
  type FSRS,
  type Grade as FsrsGrade,
  type RecordLog,
} from "ts-fsrs";

/**
 * Singleton FSRS scheduler. Default parameters with fuzz enabled so cards in
 * the same batch don't all come due at the exact same moment.
 */
let instance: FSRS | null = null;
export function getScheduler(): FSRS {
  if (!instance) {
    instance = fsrs(generatorParameters({ enable_fuzz: true }));
  }
  return instance;
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

/** Predicted intervals for each rating, given the card's current state. */
export interface IntervalPreview {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

export function previewIntervals(card: FsrsCard, now: Date = new Date()): IntervalPreview {
  const log: RecordLog = getScheduler().repeat(card, now);
  return {
    again: formatInterval(log[Rating.Again].card.scheduled_days),
    hard: formatInterval(log[Rating.Hard].card.scheduled_days),
    good: formatInterval(log[Rating.Good].card.scheduled_days),
    easy: formatInterval(log[Rating.Easy].card.scheduled_days),
  };
}

/** Default (new) FSRS card. */
export function emptyCard(now: Date = new Date()): FsrsCard {
  return createEmptyCard(now);
}

export { Rating, State };
export type { FsrsGrade };
