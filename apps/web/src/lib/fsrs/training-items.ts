/**
 * Shared FSRS optimizer training-set construction.
 *
 * Both the optimizer (`POST /api/fsrs/optimize`) and the profile readiness meter
 * build their view of "how much usable history do we have" from this single
 * source of truth, so the meter can never say "Ready to optimize" while the
 * optimizer rejects the request (or vice-versa).
 *
 * FSRS-7 measures elapsed time in fractions of a day, so every review after a
 * card's first one teaches it something — including same-day learning steps.
 * What it cannot use is a card whose history does not start from new (state
 * imported without its reviews): there is nothing to anchor the first interval.
 *
 * FSRS-6 (still fitted for cards that remain on it) works in whole days:
 * same-day reviews round to delta_t 0 and only cards with a real day gap count.
 */

export interface TrainingLogRow {
  card_id: string;
  /** Null on legacy rows written before the cloze_ord column existed. */
  cloze_ord: number | null;
  rating: number;
  review: string;
  /** Card state before the review (0 = new). Missing on rows selected without it. */
  state?: number | null;
}

export interface TrainingReview {
  rating: number;
  /** Whole days since the previous review of this scheduling unit (0 for the first). */
  deltaT: number;
}

const DAY_MS = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

/**
 * Group review logs per scheduling unit — (card, cloze_ord) — and build the
 * cumulative snapshots the native optimizer trains on. Each cloze deletion is
 * its own FSRS card, so ordinals are kept separate. Rows must be supplied in
 * chronological (review-ascending) order.
 *
 * Only snapshots for cards that have at least one real (delta_t > 0) interval
 * are emitted — mirroring fsrs-rs's requirement that every training item
 * contain a long-term review.
 */
export function buildTrainingItems(rows: TrainingLogRow[]): TrainingReview[][] {
  const byUnit = new Map<string, Array<{ rating: number; review: Date }>>();
  for (const r of rows) {
    if (r.rating < 1 || r.rating > 4) continue;
    const when = new Date(r.review);
    if (Number.isNaN(when.getTime())) continue;
    const key = `${r.card_id}:${r.cloze_ord ?? 0}`;
    const list = byUnit.get(key) ?? [];
    list.push({ rating: r.rating, review: when });
    byUnit.set(key, list);
  }

  const items: TrainingReview[][] = [];
  for (const reviews of byUnit.values()) {
    if (reviews.length < 2) continue;
    const cumulative: TrainingReview[] = [];
    let hasLongTermReview = false;
    for (let i = 0; i < reviews.length; i++) {
      const rawDelta =
        i === 0 ? 0 : Math.round(daysBetween(reviews[i - 1].review, reviews[i].review));
      // First review's delta_t must be 0; clamp negatives/NaN from clock skew.
      const deltaT = i === 0 || !Number.isFinite(rawDelta) ? 0 : Math.max(0, rawDelta);
      cumulative.push({ rating: reviews[i].rating, deltaT });
      if (deltaT > 0) hasLongTermReview = true;
      if (i >= 1 && hasLongTermReview) {
        items.push([...cumulative]);
      }
    }
  }
  return items;
}

type UnitReview = { rating: number; state: number; time: number };

/**
 * Reviews FSRS-7 can train on, per scheduling unit, in the order they
 * happened: everything from the last time the card was new onward. Units that
 * never start from new or have a single review are left out.
 */
function fsrs7TrainingUnits(rows: TrainingLogRow[]): Map<string, UnitReview[]> {
  const byUnit = new Map<string, UnitReview[]>();
  for (const r of rows) {
    if (r.rating < 1 || r.rating > 4) continue;
    const time = Date.parse(r.review);
    if (!Number.isFinite(time)) continue;
    const key = `${r.card_id}:${r.cloze_ord ?? 0}`;
    const list = byUnit.get(key) ?? [];
    list.push({ rating: r.rating, state: Number(r.state ?? -1), time });
    byUnit.set(key, list);
  }
  const usable = new Map<string, UnitReview[]>();
  for (const [key, reviews] of byUnit) {
    reviews.sort((a, b) => a.time - b.time);
    let start = -1;
    for (let i = 0; i < reviews.length; i++) {
      if (reviews[i]!.state === 0) start = i;
    }
    if (start < 0) continue;
    const block = reviews.slice(start);
    if (block.length >= 2) usable.set(key, block);
  }
  return usable;
}

/**
 * Number of reviews the FSRS-7 optimizer can learn from: each review after
 * the first of a card that has been followed since it was new.
 */
export function countUsableTrainingItems(rows: TrainingLogRow[]): number {
  let count = 0;
  for (const reviews of fsrs7TrainingUnits(rows).values()) count += reviews.length - 1;
  return count;
}

/**
 * Review-log CSV in the layout the optimizer's converter reads, holding
 * exactly the reviews counted by {@link countUsableTrainingItems}.
 */
export function buildFsrs7TrainingCsv(rows: TrainingLogRow[]): Uint8Array {
  const lines = ["review_time,card_id,review_rating,review_duration,review_state"];
  const all: Array<UnitReview & { key: string }> = [];
  for (const [key, reviews] of fsrs7TrainingUnits(rows)) {
    for (const review of reviews) all.push({ ...review, key });
  }
  all.sort((a, b) => a.time - b.time);
  for (const review of all) {
    // Review duration is not recorded for study reviews; the trainer ignores it.
    lines.push(`${review.time},${review.key},${review.rating},0,${review.state}`);
  }
  return new TextEncoder().encode(lines.join("\n"));
}
