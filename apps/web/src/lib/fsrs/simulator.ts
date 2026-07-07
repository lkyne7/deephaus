import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
} from "ts-fsrs";

/**
 * FSRS review-load simulator (Anki-style).
 *
 * Runs a day-granularity Monte-Carlo simulation of a deck: existing scheduled
 * cards come due and are re-scheduled with ts-fsrs (the exact scheduler used
 * for real reviews), and `newPerDay` fresh cards are introduced each day until
 * the backlog runs out. Ratings are sampled from the same distributions
 * fsrs-rs uses for its simulator, with pass probability tied to each card's
 * predicted retrievability at review time.
 *
 * The RNG is seeded so repeated runs with identical inputs produce identical
 * projections (no flickering charts).
 */

const DAY_MS = 86_400_000;
/** Reviews happen at a fixed mid-day offset to stay clear of midnight edges. */
const REVIEW_HOUR_MS = 12 * 3_600_000;
/** Safety bound on same-day learning steps per card per day. */
const MAX_SAME_DAY_STEPS = 5;

/**
 * Rating distributions from fsrs-rs's SimulatorConfig defaults.
 * First review of a new card: P(again, hard, good, easy).
 */
const FIRST_RATING_PROB = [0.24, 0.094, 0.495, 0.171] as const;
/** Subsequent successful reviews: P(hard, good, easy) given the card passed. */
const REVIEW_RATING_PROB = [0.224, 0.631, 0.145] as const;

export interface SimulatorCardState {
  stability: number;
  difficulty: number;
  /** ts-fsrs State (1=learning, 2=review, 3=relearning). */
  state: number;
  /** ISO timestamp the card is currently due. */
  due: string;
  /** ISO timestamp of the last review, when known. */
  lastReview: string | null;
  scheduledDays: number;
  reps: number;
  lapses: number;
  learningSteps: number;
}

export interface SimulatorOptions {
  /** Days to project, starting today. */
  days: number;
  /** New cards introduced per day. */
  newPerDay: number;
  /** How many unseen cards remain in the deck. */
  newCardsRemaining: number;
  desiredRetention: number;
  /** FSRS weights (defaults to ts-fsrs defaults when omitted). */
  w?: number[];
  /** Optional hard cap on reviews per day; overflow rolls to the next day. */
  maxReviewsPerDay?: number;
  /** Existing scheduled (non-new, non-suspended) cards. */
  cards: SimulatorCardState[];
  seed?: number;
}

export interface SimulatorDayResult {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Scheduled cards reviewed this day (existing + previously introduced). */
  review: number;
  /** New cards introduced this day. */
  new: number;
  total: number;
}

export interface SimulatorResult {
  days: SimulatorDayResult[];
  summary: {
    totalReviews: number;
    totalNew: number;
    averagePerDay: number;
    peak: { date: string; count: number };
  };
}

/** Deterministic 32-bit RNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleFirstRating(rng: () => number): Grade {
  const roll = rng();
  let acc = 0;
  const grades: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];
  for (let i = 0; i < FIRST_RATING_PROB.length; i++) {
    acc += FIRST_RATING_PROB[i];
    if (roll < acc) return grades[i];
  }
  return Rating.Good;
}

/** Sample a review grade: fail with probability (1 - retrievability). */
function sampleReviewRating(rng: () => number, retrievability: number): Grade {
  if (rng() > retrievability) return Rating.Again;
  const roll = rng();
  const total = REVIEW_RATING_PROB[0] + REVIEW_RATING_PROB[1] + REVIEW_RATING_PROB[2];
  if (roll < REVIEW_RATING_PROB[0] / total) return Rating.Hard;
  if (roll < (REVIEW_RATING_PROB[0] + REVIEW_RATING_PROB[1]) / total) return Rating.Easy;
  return Rating.Good;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function simulateReviews(options: SimulatorOptions): SimulatorResult {
  const days = Math.max(1, Math.floor(options.days));
  const newPerDay = Math.max(0, Math.floor(options.newPerDay));
  const rng = mulberry32(options.seed ?? 1337);

  // Fuzz off: the simulation itself is stochastic; deterministic intervals
  // keep the projection stable for the same inputs.
  const scheduler = fsrs(
    generatorParameters({
      enable_fuzz: false,
      ...(options.w ? { w: options.w } : {}),
      request_retention: options.desiredRetention,
    }),
  );

  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const baseMs = base.getTime();
  const dayIndexOf = (date: Date) => Math.floor((date.getTime() - baseMs) / DAY_MS);
  const reviewTimeFor = (day: number) => new Date(baseMs + day * DAY_MS + REVIEW_HOUR_MS);

  // Hydrate existing cards into ts-fsrs Card objects.
  const cards: FsrsCard[] = options.cards.map((c) => ({
    due: new Date(c.due),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: 0,
    scheduled_days: c.scheduledDays,
    learning_steps: c.learningSteps ?? 0,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as State,
    last_review: c.lastReview ? new Date(c.lastReview) : undefined,
  }));

  // Bucket cards by the day they come due (overdue cards land on day 0).
  const buckets: number[][] = Array.from({ length: days }, () => []);
  cards.forEach((card, index) => {
    const day = Math.max(0, dayIndexOf(card.due));
    if (day < days) buckets[day].push(index);
  });

  /** Review one card "today", resolving same-day learning steps in-place. */
  const reviewCardToday = (card: FsrsCard, day: number, isFirstReview: boolean): FsrsCard => {
    let current = card;
    let when = reviewTimeFor(day);
    const nextDayMs = baseMs + (day + 1) * DAY_MS;
    for (let step = 0; step < MAX_SAME_DAY_STEPS; step++) {
      const grade =
        isFirstReview && step === 0
          ? sampleFirstRating(rng)
          : sampleReviewRating(
              rng,
              current.state === State.New
                ? 0.9
                : scheduler.get_retrievability(current, when, false),
            );
      current = scheduler.next(current, when, grade).card;
      if (current.due.getTime() >= nextDayMs) return current;
      // Learning step due later today — study it again when it comes up.
      when = new Date(Math.max(current.due.getTime(), when.getTime() + 60_000));
    }
    // Still intraday after the step budget: push to tomorrow.
    current.due = new Date(nextDayMs + REVIEW_HOUR_MS);
    return current;
  };

  const series: SimulatorDayResult[] = [];
  let newRemaining = Math.max(0, Math.floor(options.newCardsRemaining));
  const maxPerDay =
    options.maxReviewsPerDay && options.maxReviewsPerDay > 0
      ? Math.floor(options.maxReviewsPerDay)
      : Infinity;

  for (let day = 0; day < days; day++) {
    let queue = buckets[day];

    // Cap the day's workload; overflow rolls into tomorrow's queue (backlog).
    if (queue.length > maxPerDay) {
      const overflow = queue.slice(maxPerDay);
      queue = queue.slice(0, maxPerDay);
      if (day + 1 < days) buckets[day + 1].unshift(...overflow);
    }

    let reviewCount = 0;
    for (const index of queue) {
      const updated = reviewCardToday(cards[index], day, false);
      cards[index] = updated;
      reviewCount++;
      const nextDay = dayIndexOf(updated.due);
      if (nextDay > day && nextDay < days) buckets[nextDay].push(index);
    }

    // Introduce new cards (respecting the daily review cap).
    const capacityLeft = Math.max(0, maxPerDay - reviewCount);
    const introduced = Math.min(newPerDay, newRemaining, capacityLeft);
    for (let i = 0; i < introduced; i++) {
      const fresh = createEmptyCard(reviewTimeFor(day));
      const updated = reviewCardToday(fresh, day, true);
      const index = cards.push(updated) - 1;
      const nextDay = dayIndexOf(updated.due);
      if (nextDay > day && nextDay < days) buckets[nextDay].push(index);
    }
    newRemaining -= introduced;

    series.push({
      date: toIsoDate(new Date(baseMs + day * DAY_MS)),
      review: reviewCount,
      new: introduced,
      total: reviewCount + introduced,
    });
  }

  let totalReviews = 0;
  let totalNew = 0;
  let peak = { date: series[0]?.date ?? toIsoDate(base), count: 0 };
  for (const d of series) {
    totalReviews += d.review;
    totalNew += d.new;
    if (d.total > peak.count) peak = { date: d.date, count: d.total };
  }

  return {
    days: series,
    summary: {
      totalReviews,
      totalNew,
      averagePerDay: Math.round(((totalReviews + totalNew) / days) * 10) / 10,
      peak,
    },
  };
}
