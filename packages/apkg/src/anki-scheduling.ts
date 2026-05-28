/**
 * Convert one Anki card's scheduling state into DeepHaus `card_reviews` fields
 * (which mirror a ts-fsrs Card).
 *
 * Anki cards may carry native FSRS memory state in their `data` JSON (`s`,`d`).
 * When present we use it directly. Otherwise we approximate FSRS stability /
 * difficulty from the SM-2 interval and ease factor — the same idea Anki uses
 * when first enabling FSRS on an SM-2 collection.
 */

export interface AnkiCardSched {
  /** 0=new, 1=learning, 2=review, 3=relearning */
  type: number;
  /** -3..4; -1 = suspended */
  queue: number;
  /** review: days since collection crt; learning: epoch seconds; new: position */
  due: number;
  /** interval: positive = days, negative = seconds */
  ivl: number;
  /** ease factor ×1000 (2500 = 250%) */
  factor: number;
  reps: number;
  lapses: number;
  /** card.data JSON string (may contain FSRS {"s":..,"d":..}) */
  data: string | null;
}

export interface FsrsReviewFields {
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
  suspended: boolean;
}

const DAY_MS = 86_400_000;
const SECONDS_PER_DAY = 86_400;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Difficulty (1–10) approximated from an Anki ease factor (×1000). */
function difficultyFromEase(factor: number): number {
  if (!factor || factor <= 0) return 5;
  // factor 2500 → 5, 1300 → ~8, 3500 → ~2.5; clamped to FSRS's [1,10].
  return clamp(5 + (2500 - factor) / 1000 * 2.5, 1, 10);
}

/** Pull native FSRS memory state out of an Anki card's `data` JSON. */
function fsrsMemoryFromData(data: string | null): { s: number; d: number } | null {
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const s = parsed.s;
    const d = parsed.d;
    if (typeof s === "number" && typeof d === "number" && s > 0 && Number.isFinite(s) && Number.isFinite(d)) {
      return { s, d };
    }
  } catch {
    // not JSON / no FSRS data
  }
  return null;
}

function intervalDays(ivl: number): number {
  if (ivl > 0) return ivl;
  if (ivl < 0) return Math.max(0, -ivl / SECONDS_PER_DAY);
  return 0;
}

function dueDate(card: AnkiCardSched, crtSeconds: number, now: Date): Date {
  // Intraday learning cards store an absolute epoch-second due.
  if ((card.queue === 1 || card.type === 1) && card.due > 1_000_000_000) {
    const d = new Date(card.due * 1000);
    return Number.isFinite(d.getTime()) ? d : now;
  }
  // Review / day-learning cards store days since collection creation.
  if (card.queue === 2 || card.queue === 3 || card.type === 2 || card.type === 3) {
    const d = new Date((crtSeconds + card.due * SECONDS_PER_DAY) * 1000);
    return Number.isFinite(d.getTime()) ? d : now;
  }
  return now;
}

/**
 * Map an Anki card to `card_reviews` fields. Returns null for a plain new card
 * (no review history and not suspended) so it imports as a fresh new card.
 */
export function ankiCardToFsrs(
  card: AnkiCardSched,
  crtSeconds: number,
  now: Date = new Date(),
): FsrsReviewFields | null {
  const suspended = card.queue === -1;
  const state = card.type >= 0 && card.type <= 3 ? card.type : 0;

  if (state === 0 && !suspended) return null;

  if (state === 0) {
    // Suspended-but-new: keep an empty review row just to carry the suspend flag.
    return {
      due: now.toISOString(),
      stability: 0,
      difficulty: 0,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: Math.max(0, card.reps | 0),
      lapses: Math.max(0, card.lapses | 0),
      state: 0,
      last_review: null,
      learning_steps: 0,
      suspended: true,
    };
  }

  const scheduledDays = intervalDays(card.ivl);
  const due = dueDate(card, crtSeconds, now);

  const memory = fsrsMemoryFromData(card.data);
  const stability = memory
    ? Math.max(0.1, memory.s)
    : Math.max(0.1, scheduledDays || 0.5);
  const difficulty = memory ? clamp(memory.d, 1, 10) : difficultyFromEase(card.factor);

  // Anchor last_review so "interval since last review" ≈ scheduled_days, but
  // never in the future.
  let lastReview: Date;
  if (state === 2 || state === 3) {
    lastReview = new Date(due.getTime() - scheduledDays * DAY_MS);
  } else {
    lastReview = now;
  }
  if (lastReview.getTime() > now.getTime()) lastReview = now;

  return {
    due: due.toISOString(),
    stability,
    difficulty,
    elapsed_days: 0,
    scheduled_days: scheduledDays,
    reps: Math.max(0, card.reps | 0),
    lapses: Math.max(0, card.lapses | 0),
    state,
    last_review: lastReview.toISOString(),
    learning_steps: 0,
    suspended,
  };
}
