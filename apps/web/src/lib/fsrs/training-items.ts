/**
 * Shared FSRS optimizer training-set construction.
 *
 * Both the optimizer (`POST /api/fsrs/optimize`) and the profile readiness meter
 * build their view of "how much usable history do we have" from this single
 * source of truth, so the meter can never say "Ready to optimize" while the
 * optimizer rejects the request (or vice-versa).
 *
 * The key idea: FSRS learns your forgetting curve from reviews separated by real
 * calendar days. Same-day reviews (learning steps, lapses, cramming) all round
 * to delta_t 0 and teach the model nothing about long-term decay, so they don't
 * count as usable training items.
 */

export interface TrainingLogRow {
  card_id: string;
  /** Null on legacy rows written before the cloze_ord column existed. */
  cloze_ord: number | null;
  rating: number;
  review: string;
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

/** Count usable training items without materializing intermediate snapshots. */
export function countUsableTrainingItems(rows: TrainingLogRow[]): number {
  return buildTrainingItems(rows).length;
}
