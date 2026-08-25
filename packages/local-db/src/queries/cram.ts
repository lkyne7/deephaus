import type { AbstractPowerSyncDatabase } from "@powersync/common";
import {
  buildCramScheduler,
  calculateReadiness,
  cramQueueKey,
  estimatedSecondsPerReview,
  previewIntervals,
  retrievabilityAt,
  reviewCapacity,
  rowToCard,
  sortCramQueue,
  startOfStudyDay,
  validParamsOrUndefined,
  type CramPlanItemRow,
  type CramPlanRow,
  type CramQueueCard,
  type CramReadiness,
  type CramTodaySummary,
  type FsrsGrade,
  type IntervalPreview,
} from "@deephaus/scheduling";
import { gradeCramItemLocally } from "../mutations/reviews";

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function rowToPlan(row: Record<string, unknown>): CramPlanRow {
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    name: String(row.name ?? ""),
    status: String(row.status ?? "draft") as CramPlanRow["status"],
    deadline_at: String(row.deadline_at ?? ""),
    deadline_timezone: String(row.deadline_timezone ?? "UTC"),
    deadline_has_time: Number(row.deadline_has_time ?? 0) !== 0,
    target_retention: Number(row.target_retention ?? 0.9),
    daily_minutes: Number(row.daily_minutes ?? 30),
    selection_spec: (parseJson(row.selection_spec) ?? {
      deck_ids: [],
      source_ids: [],
      chunk_ids: [],
      tags: [],
      card_ids: [],
    }) as CramPlanRow["selection_spec"],
    estimated_seconds_per_review: Number(row.estimated_seconds_per_review ?? 20),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    started_at: (row.started_at as string | null) ?? null,
    paused_at: (row.paused_at as string | null) ?? null,
    completed_at: (row.completed_at as string | null) ?? null,
    archived_at: (row.archived_at as string | null) ?? null,
  };
}

function rowToItem(row: Record<string, unknown>): CramPlanItemRow {
  return {
    id: String(row.id),
    plan_id: String(row.plan_id),
    card_id: String(row.card_id),
    project_id: String(row.project_id),
    cloze_ord: Number(row.cloze_ord ?? 0),
    due: String(row.due ?? ""),
    stability: Number(row.stability ?? 0),
    difficulty: Number(row.difficulty ?? 0),
    elapsed_days: Number(row.elapsed_days ?? 0),
    scheduled_days: Number(row.scheduled_days ?? 0),
    reps: Number(row.reps ?? 0),
    lapses: Number(row.lapses ?? 0),
    state: Number(row.state ?? 0),
    last_review: (row.last_review as string | null) ?? null,
    learning_steps: Number(row.learning_steps ?? 0),
    version: Number(row.version ?? 0),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export async function getLocalCramPlans(
  db: AbstractPowerSyncDatabase,
): Promise<CramPlanRow[]> {
  const rows = await db.getAll<Record<string, unknown>>(
    `SELECT * FROM cram_plans ORDER BY deadline_at ASC`,
  );
  return rows.map(rowToPlan);
}

export async function getLocalCramPlan(
  db: AbstractPowerSyncDatabase,
  planId: string,
): Promise<CramPlanRow | null> {
  const row = await db.getOptional<Record<string, unknown>>(
    `SELECT * FROM cram_plans WHERE id = ?`,
    [planId],
  );
  return row ? rowToPlan(row) : null;
}

export async function getLocalCramItems(
  db: AbstractPowerSyncDatabase,
  planId: string,
): Promise<CramPlanItemRow[]> {
  const rows = await db.getAll<Record<string, unknown>>(
    `SELECT * FROM cram_plan_items WHERE plan_id = ?`,
    [planId],
  );
  return rows.map(rowToItem);
}

/** Per-deck FSRS params for a plan (from cram_plan_deck_profiles). */
export async function getLocalCramDeckParams(
  db: AbstractPowerSyncDatabase,
  planId: string,
): Promise<Map<string, number[]>> {
  const rows = await db.getAll<{ project_id: string; fsrs_params: string | null }>(
    `SELECT project_id, fsrs_params FROM cram_plan_deck_profiles WHERE plan_id = ?`,
    [planId],
  );
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const params = validParamsOrUndefined(parseJson(row.fsrs_params));
    if (params) map.set(row.project_id, params);
  }
  return map;
}

/**
 * Local cram queue: sorts plan items with the shared comparator and joins in
 * card content, mirroring the server queue endpoint's card payload.
 */
export async function buildLocalCramQueue(
  db: AbstractPowerSyncDatabase,
  planId: string,
  limit: number,
  now: Date = new Date(),
): Promise<CramQueueCard[]> {
  const plan = await getLocalCramPlan(db, planId);
  if (!plan) return [];

  const [items, paramsByProject] = await Promise.all([
    getLocalCramItems(db, planId),
    getLocalCramDeckParams(db, planId),
  ]);
  if (items.length === 0) return [];

  const deadline = new Date(plan.deadline_at);
  const sorted = sortCramQueue(items, now, deadline, plan.target_retention, paramsByProject).slice(
    0,
    Math.max(1, limit),
  );

  const cardIds = [...new Set(sorted.map((item) => item.card_id))];
  const placeholders = cardIds.map(() => "?").join(", ");
  const cardRows = await db.getAll<Record<string, unknown>>(
    `SELECT id, type, front, back, cloze_text, extra, occlusion_data, tags
     FROM cards WHERE id IN (${placeholders})`,
    cardIds,
  );
  const cardsById = new Map(cardRows.map((row) => [String(row.id), row]));

  const queue: CramQueueCard[] = [];
  for (const item of sorted) {
    const card = cardsById.get(item.card_id);
    if (!card) continue;
    const scheduler = buildCramScheduler(
      paramsByProject.get(item.project_id),
      plan.target_retention,
      true,
    );
    const cardType = String(card.type) as CramQueueCard["type"];
    queue.push({
      item_id: item.id,
      id: item.card_id,
      queue_key: cramQueueKey(item.card_id, cardType, item.cloze_ord),
      cloze_ord:
        cardType === "cloze" || cardType === "image-occlusion" ? item.cloze_ord : null,
      type: cardType,
      front: (card.front as string | null) ?? null,
      back: (card.back as string | null) ?? null,
      cloze_text: (card.cloze_text as string | null) ?? null,
      extra: (card.extra as string | null) ?? null,
      occlusion_data: parseJson(card.occlusion_data),
      tags: (parseJson(card.tags) as string[] | null) ?? [],
      state: item.state,
      due: item.due,
      reps: item.reps,
      lapses: item.lapses,
      is_new: item.state === 0,
      intervals: previewIntervals(scheduler, rowToCard(item), now),
    });
  }
  return queue;
}

export interface LocalCramTodayProgress {
  reviews_completed: number;
  response_ms_values: number[];
}

export async function getLocalCramTodayProgress(
  db: AbstractPowerSyncDatabase,
  planId: string,
  dayStartIso: string,
): Promise<LocalCramTodayProgress> {
  const rows = await db.getAll<{ response_ms: number | null }>(
    `SELECT response_ms FROM cram_review_logs
     WHERE plan_id = ? AND review >= ?`,
    [planId, dayStartIso],
  );
  return {
    reviews_completed: rows.length,
    response_ms_values: rows
      .map((row) => Number(row.response_ms ?? 0))
      .filter((value) => value > 0),
  };
}

function localDateKey(now: Date, timeZone: string): string {
  try {
    const dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return dtf.format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

interface LocalPlanTiming {
  secondsPerReview: number;
  today: {
    reviewsCompleted: number;
    responseMs: number;
    reviewCapacity: number;
  };
}

/** Local mirror of loadPlanTiming: recent + today's cram logs from SQLite. */
async function loadLocalPlanTiming(
  db: AbstractPowerSyncDatabase,
  plan: CramPlanRow,
  now: Date,
): Promise<LocalPlanTiming> {
  const dayStart = startOfStudyDay(now, 0, plan.deadline_timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);

  const [recentRows, todayRows] = await Promise.all([
    db.getAll<{ response_ms: number | null }>(
      `SELECT response_ms FROM cram_review_logs
       WHERE plan_id = ? AND response_ms IS NOT NULL
       ORDER BY review DESC LIMIT 101`,
      [plan.id],
    ),
    db.getAll<{ response_ms: number | null }>(
      `SELECT response_ms FROM cram_review_logs
       WHERE plan_id = ? AND review >= ? AND review < ?`,
      [plan.id, dayStart.toISOString(), dayEnd.toISOString()],
    ),
  ]);

  const recentMs = recentRows.flatMap((row) =>
    typeof row.response_ms === "number" ? [row.response_ms] : [],
  );
  const todayMs = todayRows.flatMap((row) =>
    typeof row.response_ms === "number" ? [row.response_ms] : [],
  );
  const secondsPerReview = estimatedSecondsPerReview(
    recentMs,
    plan.estimated_seconds_per_review || 20,
  );
  return {
    secondsPerReview,
    today: {
      reviewsCompleted: todayRows.length,
      responseMs: todayMs.reduce((sum, value) => sum + value, 0),
      reviewCapacity: reviewCapacity(plan.daily_minutes, secondsPerReview),
    },
  };
}

function localTodayDto(
  plan: CramPlanRow,
  timing: LocalPlanTiming,
  queueRemaining?: number,
): CramTodaySummary {
  const reviewsRemaining = Math.max(
    0,
    Math.min(
      timing.today.reviewCapacity - timing.today.reviewsCompleted,
      Math.floor(
        Math.max(0, plan.daily_minutes * 60_000 - timing.today.responseMs) /
          (timing.secondsPerReview * 1000),
      ),
    ),
  );
  return {
    date: localDateKey(new Date(), plan.deadline_timezone),
    daily_minutes: plan.daily_minutes,
    estimated_seconds_per_review: timing.secondsPerReview,
    review_capacity: timing.today.reviewCapacity,
    reviews_completed: timing.today.reviewsCompleted,
    response_ms: timing.today.responseMs,
    minutes_spent: timing.today.responseMs / 60_000,
    reviews_remaining:
      queueRemaining == null ? reviewsRemaining : Math.min(reviewsRemaining, queueRemaining),
    budget_reached:
      timing.today.reviewsCompleted >= timing.today.reviewCapacity ||
      timing.today.responseMs >= plan.daily_minutes * 60_000,
  };
}

export interface LocalCramQueuePayload {
  plan: CramPlanRow & { name: string };
  cards: CramQueueCard[];
  counts: {
    total: number;
    queued: number;
    due: number;
    new: number;
    remaining: number;
  };
  readiness: CramReadiness;
  readiness_score: number;
  today: CramTodaySummary;
  daily_budget: number;
  reviewed_today: number;
  remaining_today: number;
  budget_reached: boolean;
}

/**
 * Local replica of GET /api/cram-plans/{id}/queue: sorted eligible items,
 * budget-capped page, readiness and today's budget — all from SQLite.
 */
export async function getLocalCramQueuePayload(
  db: AbstractPowerSyncDatabase,
  planId: string,
  options: { limit?: number; continuePastBudget?: boolean } = {},
): Promise<LocalCramQueuePayload | null> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const now = new Date();

  const plan = await getLocalCramPlan(db, planId);
  if (!plan || plan.status !== "active") return null;

  const [items, paramsByProject, timing] = await Promise.all([
    getLocalCramItems(db, planId),
    getLocalCramDeckParams(db, planId),
    loadLocalPlanTiming(db, plan, now),
  ]);

  const deadline = new Date(plan.deadline_at);
  const sorted = sortCramQueue(items, now, deadline, plan.target_retention, paramsByProject).filter(
    (item) =>
      item.state === 0 ||
      new Date(item.due).getTime() <= now.getTime() ||
      retrievabilityAt(
        item,
        deadline,
        paramsByProject.get(item.project_id),
        plan.target_retention,
      ) < plan.target_retention,
  );

  const remainingBudget = Math.max(
    0,
    Math.min(
      timing.today.reviewCapacity - timing.today.reviewsCompleted,
      Math.floor(
        Math.max(0, plan.daily_minutes * 60_000 - timing.today.responseMs) /
          (timing.secondsPerReview * 1000),
      ),
    ),
  );
  const take = options.continuePastBudget ? limit : Math.min(limit, remainingBudget);
  const selected = sorted.slice(0, take);

  let cards: CramQueueCard[] = [];
  if (selected.length > 0) {
    const cardIds = [...new Set(selected.map((item) => item.card_id))];
    const placeholders = cardIds.map(() => "?").join(", ");
    const cardRows = await db.getAll<Record<string, unknown>>(
      `SELECT id, type, front, back, cloze_text, extra, occlusion_data, tags
       FROM cards WHERE id IN (${placeholders})`,
      cardIds,
    );
    const cardsById = new Map(cardRows.map((row) => [String(row.id), row]));
    cards = selected.flatMap((item) => {
      const card = cardsById.get(item.card_id);
      if (!card) return [];
      const scheduler = buildCramScheduler(
        paramsByProject.get(item.project_id),
        plan.target_retention,
      );
      const cardType = String(card.type) as CramQueueCard["type"];
      return [
        {
          item_id: item.id,
          id: item.card_id,
          queue_key: cramQueueKey(item.card_id, cardType, item.cloze_ord),
          cloze_ord:
            cardType === "cloze" || cardType === "image-occlusion" ? item.cloze_ord : null,
          type: cardType,
          front: (card.front as string | null) ?? null,
          back: (card.back as string | null) ?? null,
          cloze_text: (card.cloze_text as string | null) ?? null,
          extra: (card.extra as string | null) ?? null,
          occlusion_data: parseJson(card.occlusion_data),
          tags: (parseJson(card.tags) as string[] | null) ?? [],
          state: item.state,
          due: item.due,
          reps: item.reps,
          lapses: item.lapses,
          is_new: item.state === 0,
          intervals: previewIntervals(scheduler, rowToCard(item), now),
        },
      ];
    });
  }

  const readiness = calculateReadiness(items, deadline, plan.target_retention, paramsByProject);
  const today = localTodayDto(plan, timing, sorted.length);
  const due = items.filter(
    (item) => item.state !== 0 && new Date(item.due).getTime() <= now.getTime(),
  ).length;
  const unseen = items.filter((item) => item.state === 0).length;

  return {
    plan,
    cards,
    counts: {
      total: items.length,
      queued: cards.length,
      due,
      new: unseen,
      remaining: sorted.length,
    },
    readiness,
    readiness_score: readiness.mean_retrievability,
    today,
    daily_budget: today.review_capacity,
    reviewed_today: today.reviews_completed,
    remaining_today: today.reviews_remaining,
    budget_reached: today.budget_reached,
  };
}

export interface LocalCramReviewResult {
  item_id: string;
  version: number;
  intervals: IntervalPreview;
  today: CramTodaySummary;
}

/** Local replica of POST /api/cram-plans/{id}/review (record_cram_review). */
export async function submitLocalCramReview(
  db: AbstractPowerSyncDatabase,
  input: {
    userId: string;
    planId: string;
    itemId: string;
    rating: FsrsGrade;
    responseMs?: number;
  },
): Promise<LocalCramReviewResult> {
  const now = new Date();
  const plan = await getLocalCramPlan(db, input.planId);
  if (!plan) throw new Error("Cram Plan not found");
  if (plan.status !== "active") throw new Error("Cram Plan is not active");

  const itemRow = await db.getOptional<Record<string, unknown>>(
    `SELECT * FROM cram_plan_items WHERE id = ? AND plan_id = ?`,
    [input.itemId, input.planId],
  );
  if (!itemRow) throw new Error("Cram Plan item not found");
  const item = rowToItem(itemRow);

  const paramsByProject = await getLocalCramDeckParams(db, input.planId);
  const result = await gradeCramItemLocally(db, {
    userId: input.userId,
    item,
    rating: input.rating,
    targetRetention: plan.target_retention,
    fsrsParams: paramsByProject.get(item.project_id),
    responseMs: input.responseMs,
    now,
  });

  const timing = await loadLocalPlanTiming(db, plan, now);
  return {
    item_id: item.id,
    version: item.version + 1,
    intervals: result.intervals,
    today: localTodayDto(plan, timing),
  };
}

function localPlanSummary(
  plan: CramPlanRow,
  items: CramPlanItemRow[],
  readiness: CramReadiness,
  secondsPerReview: number,
) {
  const cardCount = new Set(items.map((item) => item.card_id)).size;
  const unseen = items.filter((item) => item.state === 0).length;
  return {
    ...plan,
    estimated_seconds_per_review: secondsPerReview,
    item_count: items.length,
    card_count: cardCount,
    readiness: readiness.mean_retrievability,
    readiness_score: readiness.mean_retrievability,
    target_coverage: readiness.target_coverage,
    counts: {
      total: items.length,
      new: unseen,
      reviewed: items.length - unseen,
    },
  };
}

function localForecast(
  plan: CramPlanRow,
  items: CramPlanItemRow[],
  readiness: CramReadiness,
  secondsPerReview: number,
) {
  const now = new Date();
  const deadline = new Date(plan.deadline_at);
  const daysRemaining = Math.max(
    0,
    Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000),
  );
  const newCount = items.filter((item) => item.state === 0).length;
  const dueCount = items.filter(
    (item) => item.state !== 0 && new Date(item.due).getTime() <= now.getTime(),
  ).length;
  const estimatedReviews = Math.max(newCount + dueCount, items.length);
  const dailyReviewCapacity = reviewCapacity(
    plan.daily_minutes,
    secondsPerReview,
  );
  const totalReviewCapacity = dailyReviewCapacity * daysRemaining;
  const reviewsPerDay =
    daysRemaining > 0 ? Math.ceil(estimatedReviews / daysRemaining) : estimatedReviews;
  const estimatedMinutes = (estimatedReviews * secondsPerReview) / 60;

  return {
    generated_at: now.toISOString(),
    deadline_at: plan.deadline_at,
    days_remaining: daysRemaining,
    item_count: items.length,
    new_count: newCount,
    due_count: dueCount,
    estimated_seconds_per_review: secondsPerReview,
    daily_review_capacity: dailyReviewCapacity,
    total_review_capacity: totalReviewCapacity,
    estimated_reviews: estimatedReviews,
    estimated_minutes: estimatedMinutes,
    feasible: daysRemaining > 0 && totalReviewCapacity >= estimatedReviews,
    readiness: readiness.mean_retrievability,
    readiness_score: readiness.mean_retrievability,
    readiness_detail: readiness,
    target_coverage: readiness.target_coverage,
    total_cards: new Set(items.map((item) => item.card_id)).size,
    cards_selected: new Set(items.map((item) => item.card_id)).size,
    cards_due_today: dueCount,
    reviews_per_day: reviewsPerDay,
    estimated_daily_minutes: Math.ceil(
      (reviewsPerDay * secondsPerReview) / 60,
    ),
    daily: [],
  };
}

async function localPlanPresentation(
  db: AbstractPowerSyncDatabase,
  plan: CramPlanRow,
) {
  const [items, paramsByProject, timing] = await Promise.all([
    getLocalCramItems(db, plan.id),
    getLocalCramDeckParams(db, plan.id),
    loadLocalPlanTiming(db, plan, new Date()),
  ]);
  const readiness = calculateReadiness(
    items,
    new Date(plan.deadline_at),
    plan.target_retention,
    paramsByProject,
  );
  return {
    plan: localPlanSummary(plan, items, readiness, timing.secondsPerReview),
    forecast: localForecast(plan, items, readiness, timing.secondsPerReview),
    items,
  };
}

/** API-compatible local payload for the mobile Cram Plan list. */
export async function getLocalCramPlanListPayload(
  db: AbstractPowerSyncDatabase,
): Promise<{ plans: Array<Record<string, unknown>> }> {
  const plans = await getLocalCramPlans(db);
  const presentations = await Promise.all(
    plans.map((plan) => localPlanPresentation(db, plan)),
  );
  return {
    plans: presentations.map(({ plan, forecast }) => ({ ...plan, forecast })),
  };
}

/** API-compatible local payload for one Cram Plan detail screen. */
export async function getLocalCramPlanDetailPayload(
  db: AbstractPowerSyncDatabase,
  planId: string,
): Promise<Record<string, unknown> | null> {
  const plan = await getLocalCramPlan(db, planId);
  if (!plan) return null;
  const presentation = await localPlanPresentation(db, plan);
  const rows = await db.getAll<Record<string, unknown>>(
    `SELECT i.id AS item_id, i.card_id, i.cloze_ord, c.type, c.front,
            c.cloze_text, c.tags, p.name, p.deck_name
     FROM cram_plan_items i
     JOIN cards c ON c.id = i.card_id
     JOIN generation_jobs gj ON gj.id = c.job_id
     JOIN sources s ON s.id = gj.source_id
     JOIN projects p ON p.id = s.project_id
     WHERE i.plan_id = ?
     ORDER BY i.created_at ASC
     LIMIT 12`,
    [planId],
  );
  const itemsPreview = rows.map((row) => {
    const type = String(row.type);
    return {
      id: String(row.item_id),
      item_id: String(row.item_id),
      card_id: String(row.card_id),
      cloze_ord:
        type === "cloze" || type === "image-occlusion"
          ? Number(row.cloze_ord ?? 0)
          : null,
      type,
      front:
        (row.front as string | null) ??
        (row.cloze_text as string | null) ??
        null,
      deck_name:
        (row.deck_name as string | null) ??
        (row.name as string | null) ??
        null,
      tags: (parseJson(row.tags) as string[] | null) ?? [],
    };
  });

  return {
    plan: presentation.plan,
    forecast: presentation.forecast,
    items_preview: itemsPreview,
  };
}
