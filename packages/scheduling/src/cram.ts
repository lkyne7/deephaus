import { studyQueueKey } from "@deephaus/shared";
import {
  buildScheduler,
  type CardReviewRow,
  type DeckScheduler,
  type FsrsGrade,
  type FsrsWeights,
} from "./fsrs";
import type {
  CramPlanItemRow,
  CramPlanRow,
  CramPlanStatus,
  CramReadiness,
} from "./cram-types";

export const DEFAULT_SECONDS_PER_CRAM_REVIEW = 20;

/**
 * Deterministic (fuzz-free) schedulers are pure functions of their weights, so
 * they're safe to cache. Retrievability is recomputed for every item when
 * sorting queues and calculating readiness — without this cache each call
 * would rebuild the scheduler from scratch.
 */
const deterministicSchedulerCache = new Map<string, DeckScheduler>();
const DETERMINISTIC_CACHE_LIMIT = 64;

export function buildCramScheduler(
  weights: FsrsWeights | undefined,
  targetRetention: number,
  deterministic = false,
): DeckScheduler {
  if (!deterministic) {
    return buildScheduler({ weights, requestRetention: targetRetention });
  }
  const key = `${targetRetention}|${weights?.fsrs6?.join(",") ?? "default"}|${weights?.fsrs7?.join(",") ?? "default"}`;
  const cached = deterministicSchedulerCache.get(key);
  if (cached) return cached;
  const scheduler = buildScheduler({
    weights,
    requestRetention: targetRetention,
    enableFuzz: false,
  });
  if (deterministicSchedulerCache.size >= DETERMINISTIC_CACHE_LIMIT) {
    deterministicSchedulerCache.clear();
  }
  deterministicSchedulerCache.set(key, scheduler);
  return scheduler;
}

export function retrievabilityAt(
  item: CardReviewRow,
  at: Date,
  weights?: FsrsWeights,
  targetRetention = 0.9,
): number {
  if (item.state === 0) return 0;
  return buildCramScheduler(weights, targetRetention, true).retrievability(item, at);
}

export function calculateReadiness(
  items: CramPlanItemRow[],
  deadline: Date,
  targetRetention: number,
  paramsByProject: ReadonlyMap<string, FsrsWeights>,
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
  paramsByProject: ReadonlyMap<string, FsrsWeights>,
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

export interface CramEligibilityContext {
  now: Date;
  deadline: Date;
  targetRetention: number;
  paramsByProject: ReadonlyMap<string, FsrsWeights>;
  /**
   * Start of the current study day in the plan's timezone. A not-yet-due
   * item that was already reviewed since then is skipped, so cramming pulls
   * each card forward at most once per day instead of cycling the same
   * at-risk cards all day once the due work is done.
   */
  dayStart: Date;
}

/** Due, unseen, or at risk of missing the target by the deadline. */
export function isCramItemEligible(
  item: CramPlanItemRow,
  context: CramEligibilityContext,
): boolean {
  if (item.state === 0) return true;
  if (new Date(item.due).getTime() <= context.now.getTime()) return true;
  if (
    item.last_review &&
    new Date(item.last_review).getTime() >= context.dayStart.getTime()
  ) {
    return false;
  }
  return (
    retrievabilityAt(
      item,
      context.deadline,
      context.paramsByProject.get(item.project_id),
      context.targetRetention,
    ) < context.targetRetention
  );
}

export function filterEligibleCramItems(
  items: CramPlanItemRow[],
  context: CramEligibilityContext,
): CramPlanItemRow[] {
  return items.filter((item) => isCramItemEligible(item, context));
}

export function isCramPlanPastDeadline(
  plan: Pick<CramPlanRow, "deadline_at">,
  now: Date = new Date(),
): boolean {
  const deadline = new Date(plan.deadline_at).getTime();
  return Number.isFinite(deadline) && deadline <= now.getTime();
}

/**
 * A plan that is still active or paused after its deadline is finished; the
 * server closes it on the next read, and offline clients present the same
 * status until that write syncs.
 */
export function effectiveCramPlanStatus(
  plan: Pick<CramPlanRow, "status" | "deadline_at">,
  now: Date = new Date(),
): CramPlanStatus {
  if (
    (plan.status === "active" || plan.status === "paused") &&
    isCramPlanPastDeadline(plan, now)
  ) {
    return "completed";
  }
  return plan.status;
}

export function cramQueueKey(cardId: string, cardType: string, clozeOrd: number): string {
  return studyQueueKey(
    cardId,
    cardType === "cloze" || cardType === "image-occlusion" ? clozeOrd : null,
  );
}

/**
 * Grade one cram item. Cram items carry their own copy of a card's memory and
 * have no replayable history, so each continues on the model it was copied with.
 */
export function gradeCramItem(
  item: CramPlanItemRow,
  rating: FsrsGrade,
  reviewedAt: Date,
  targetRetention: number,
  weights?: FsrsWeights,
) {
  const scheduler = buildCramScheduler(weights, targetRetention);
  const cardKey = `${item.card_id}:${item.cloze_ord}`;
  const result = scheduler.grade({ cardKey, review: item, now: reviewedAt, rating });
  return {
    next: result.next,
    log: result.log,
    intervals: scheduler.previewIntervals({
      cardKey,
      review: result.next,
      now: new Date(result.next.due),
    }),
  };
}
