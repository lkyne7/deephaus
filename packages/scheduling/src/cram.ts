import { studyQueueKey } from "@deephaus/shared";
import { fsrs, generatorParameters, type FSRS, type Grade } from "ts-fsrs";
import {
  buildScheduler,
  cardToRowFields,
  previewIntervals,
  rowToCard,
  type CardReviewRow,
} from "./fsrs";
import type { CramPlanItemRow, CramReadiness } from "./cram-types";

export const DEFAULT_SECONDS_PER_CRAM_REVIEW = 20;

/**
 * Deterministic (fuzz-free) schedulers are pure functions of their params, so
 * they're safe to cache. Retrievability is recomputed for every item when
 * sorting queues and calculating readiness — without this cache each call
 * would rebuild generator parameters from scratch.
 */
const deterministicSchedulerCache = new Map<string, FSRS>();
const DETERMINISTIC_CACHE_LIMIT = 64;

export function buildCramScheduler(
  fsrsParams: number[] | undefined,
  targetRetention: number,
  deterministic = false,
) {
  if (!deterministic) {
    return buildScheduler({ w: fsrsParams, requestRetention: targetRetention });
  }
  const key = `${targetRetention}|${fsrsParams ? fsrsParams.join(",") : "default"}`;
  const cached = deterministicSchedulerCache.get(key);
  if (cached) return cached;
  const scheduler = fsrs(
    generatorParameters({
      enable_fuzz: false,
      request_retention: targetRetention,
      ...(fsrsParams ? { w: fsrsParams } : {}),
    }),
  );
  if (deterministicSchedulerCache.size >= DETERMINISTIC_CACHE_LIMIT) {
    deterministicSchedulerCache.clear();
  }
  deterministicSchedulerCache.set(key, scheduler);
  return scheduler;
}

export function retrievabilityAt(
  item: CardReviewRow,
  at: Date,
  fsrsParams?: number[],
  targetRetention = 0.9,
): number {
  if (item.state === 0) return 0;
  const scheduler = buildCramScheduler(fsrsParams, targetRetention, true);
  const value = scheduler.get_retrievability(rowToCard(item), at, false);
  return Math.max(0, Math.min(1, Number(value)));
}

export function calculateReadiness(
  items: CramPlanItemRow[],
  deadline: Date,
  targetRetention: number,
  paramsByProject: ReadonlyMap<string, number[]>,
): CramReadiness {
  if (items.length === 0) {
    return {
      mean_retrievability: 0,
      target_coverage: 0,
      target_retention: targetRetention,
      ready_items: 0,
      total_items: 0,
      unseen_items: 0,
    };
  }

  let total = 0;
  let ready = 0;
  let unseen = 0;
  for (const item of items) {
    if (item.state === 0) unseen++;
    const retrievability = retrievabilityAt(
      item,
      deadline,
      paramsByProject.get(item.project_id),
      targetRetention,
    );
    total += retrievability;
    if (retrievability >= targetRetention) ready++;
  }

  return {
    mean_retrievability: total / items.length,
    target_coverage: ready / items.length,
    target_retention: targetRetention,
    ready_items: ready,
    total_items: items.length,
    unseen_items: unseen,
  };
}

export function rollingMedianResponseMs(values: number[]): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint];
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export function estimatedSecondsPerReview(
  responseTimesMs: number[],
  seedSeconds = DEFAULT_SECONDS_PER_CRAM_REVIEW,
): number {
  const median = rollingMedianResponseMs(responseTimesMs);
  if (median == null) return seedSeconds;
  return Math.max(5, Math.min(120, median / 1000));
}

export function reviewCapacity(dailyMinutes: number, secondsPerReview: number): number {
  if (dailyMinutes <= 0 || secondsPerReview <= 0) return 0;
  return Math.max(1, Math.floor((dailyMinutes * 60) / secondsPerReview));
}

export function sortCramQueue(
  items: CramPlanItemRow[],
  now: Date,
  deadline: Date,
  targetRetention: number,
  paramsByProject: ReadonlyMap<string, number[]>,
): CramPlanItemRow[] {
  const nowMs = now.getTime();
  // Precompute deadline risk once per item instead of inside the comparator,
  // where it would otherwise run O(n log n) FSRS retrievability calculations.
  const riskById = new Map<string, number>();
  for (const item of items) {
    if (queueBucket(item, nowMs) === 2) {
      riskById.set(
        item.id,
        targetRetention -
          retrievabilityAt(
            item,
            deadline,
            paramsByProject.get(item.project_id),
            targetRetention,
          ),
      );
    }
  }
  return [...items].sort((a, b) => {
    const bucketA = queueBucket(a, nowMs);
    const bucketB = queueBucket(b, nowMs);
    if (bucketA !== bucketB) return bucketA - bucketB;

    if (bucketA === 0) {
      const learningA = a.state === 1 || a.state === 3 ? 0 : 1;
      const learningB = b.state === 1 || b.state === 3 ? 0 : 1;
      if (learningA !== learningB) return learningA - learningB;
      return new Date(a.due).getTime() - new Date(b.due).getTime();
    }

    if (bucketA === 1) {
      const projectOrder = a.project_id.localeCompare(b.project_id);
      if (projectOrder !== 0) return projectOrder;
      const cardOrder = a.card_id.localeCompare(b.card_id);
      return cardOrder !== 0 ? cardOrder : a.cloze_ord - b.cloze_ord;
    }

    const riskA = riskById.get(a.id) ?? 0;
    const riskB = riskById.get(b.id) ?? 0;
    if (riskA !== riskB) return riskB - riskA;
    return new Date(a.due).getTime() - new Date(b.due).getTime();
  });
}

function queueBucket(item: CramPlanItemRow, nowMs: number): number {
  if (item.state !== 0 && new Date(item.due).getTime() <= nowMs) return 0;
  if (item.state === 0) return 1;
  return 2;
}

export function cramQueueKey(cardId: string, cardType: string, clozeOrd: number): string {
  return studyQueueKey(
    cardId,
    cardType === "cloze" || cardType === "image-occlusion" ? clozeOrd : null,
  );
}

export function gradeCramItem(
  item: CramPlanItemRow,
  rating: Grade,
  reviewedAt: Date,
  targetRetention: number,
  fsrsParams?: number[],
) {
  const scheduler = buildCramScheduler(fsrsParams, targetRetention);
  const result = scheduler.next(rowToCard(item), reviewedAt, rating);
  return {
    next: cardToRowFields(result.card),
    log: {
      rating,
      state: result.log.state as number,
      due: result.log.due.toISOString(),
      stability: result.log.stability,
      difficulty: result.log.difficulty,
      elapsed_days: result.log.elapsed_days,
      last_elapsed_days: result.log.last_elapsed_days,
      scheduled_days: result.log.scheduled_days,
      review: result.log.review.toISOString(),
    },
    intervals: previewIntervals(scheduler, result.card, result.card.due),
  };
}
