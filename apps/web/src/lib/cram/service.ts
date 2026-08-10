import type { SupabaseClient } from "@supabase/supabase-js";
import type { FsrsGrade } from "@/lib/fsrs/scheduler";
import { previewIntervals, rowToCard } from "@/lib/fsrs/scheduler";
import { forecastCramPlan } from "@/lib/cram/forecast";
import {
  buildCramSnapshot,
  normalizeSelectionSpec,
  type CramPlanItemInsert,
} from "@/lib/cram/selection";
import {
  buildCramScheduler,
  calculateReadiness,
  cramQueueKey,
  estimatedSecondsPerReview,
  gradeCramItem,
  reviewCapacity,
  retrievabilityAt,
  sortCramQueue,
} from "@/lib/cram/scheduler";
import { localDateKey, nextLocalDayStart, startOfLocalDay } from "@/lib/cram/time";
import type {
  CramCardRow,
  CramForecast,
  CramPlanDeckProfileRow,
  CramPlanItemRow,
  CramPlanRow,
  CramPlanStatus,
  CramQueueCard,
  CramSelectionSpec,
  CramTodaySummary,
} from "@/lib/cram/types";

const PLAN_SELECT =
  "id, user_id, name, status, deadline_at, deadline_timezone, deadline_has_time, target_retention, daily_minutes, selection_spec, estimated_seconds_per_review, started_at, paused_at, completed_at, archived_at, created_at, updated_at";
const ITEM_SELECT =
  "id, plan_id, card_id, project_id, cloze_ord, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps, version, created_at, updated_at";

export class CramServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
  ) {
    super(message);
  }
}

export interface CreateCramPlanInput {
  name: string;
  deadline_at: string;
  deadline_timezone: string;
  deadline_has_time: boolean;
  target_retention: number;
  daily_minutes: number;
  selection_spec: CramSelectionSpec;
}

export interface UpdateCramPlanInput {
  name?: string;
  deadline_at?: string;
  deadline_timezone?: string;
  deadline_has_time?: boolean;
  target_retention?: number;
  daily_minutes?: number;
  selection_spec?: CramSelectionSpec;
}

interface PlanBundle {
  plan: CramPlanRow;
  items: CramPlanItemRow[];
  profiles: CramPlanDeckProfileRow[];
}

type PlanTiming = Awaited<ReturnType<typeof loadPlanTiming>>;

export async function createCramPlan(
  supabase: SupabaseClient,
  userId: string,
  input: CreateCramPlanInput,
) {
  if (new Date(input.deadline_at).getTime() <= Date.now()) {
    throw new CramServiceError("Deadline must be in the future", 400);
  }

  const { data, error } = await supabase
    .from("cram_plans")
    .insert({
      user_id: userId,
      name: input.name,
      status: "draft",
      deadline_at: input.deadline_at,
      deadline_timezone: input.deadline_timezone,
      deadline_has_time: input.deadline_has_time,
      target_retention: input.target_retention,
      daily_minutes: input.daily_minutes,
      selection_spec: input.selection_spec,
      estimated_seconds_per_review: 20,
    })
    .select(PLAN_SELECT)
    .single();
  if (error || !data) {
    throw new CramServiceError(error?.message ?? "Could not create Cram Plan");
  }

  const plan = normalizePlan(data);
  try {
    const snapshot = await buildCramSnapshot(
      supabase,
      userId,
      plan.id,
      input.selection_spec,
    );
    if (snapshot.items.length === 0) {
      throw new CramServiceError("Selection did not resolve to any owned cards", 400);
    }
    await persistSnapshot(supabase, snapshot.items, snapshot.profiles);
  } catch (error) {
    await supabase.from("cram_plans").delete().eq("id", plan.id).eq("user_id", userId);
    throw error;
  }

  return getCramPlanDetail(supabase, userId, plan.id);
}

export async function listCramPlans(
  supabase: SupabaseClient,
  userId: string,
  status?: CramPlanStatus,
) {
  let query = supabase
    .from("cram_plans")
    .select(PLAN_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw new CramServiceError(error.message);

  const plans = (data ?? []).map(normalizePlan);
  if (plans.length === 0) return [];
  const planIds = plans.map((plan) => plan.id);
  // Items, deck profiles, and per-plan timing only need the plan rows, so load
  // them all concurrently instead of in serial stages.
  const [items, { data: profileData, error: profileError }, timings] = await Promise.all([
    loadPlanItems(supabase, planIds),
    supabase
      .from("cram_plan_deck_profiles")
      .select("plan_id, project_id, fsrs_params")
      .in("plan_id", planIds),
    Promise.all(plans.map((plan) => loadPlanTiming(supabase, plan))),
  ]);
  if (profileError) throw new CramServiceError(profileError.message);

  const profiles = normalizeProfiles(profileData ?? []);
  return plans.map((plan, index) => {
    const planItems = items.filter((item) => item.plan_id === plan.id);
    const planProfiles = profiles.filter((profile) => profile.plan_id === plan.id);
    const timing = timings[index];
    const bundle = { plan, items: planItems, profiles: planProfiles };
    const forecast = buildForecast(bundle, timing);
    return {
      ...enrichPlan(plan, planItems, planProfiles, timing.secondsPerReview),
      readiness: forecast.readiness.mean_retrievability,
      readiness_score: forecast.readiness.mean_retrievability,
      target_coverage: forecast.readiness.target_coverage,
      forecast: forecastDto(forecast),
      today: todayDto(plan, timing, eligibleQueueCount(bundle)),
    };
  });
}

export async function getCramPlanDetail(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
) {
  const { bundle, timing } = await loadPlanBundleWithTiming(supabase, userId, planId);
  const forecast = buildForecast(bundle, timing);
  const plan = enrichPlan(
    bundle.plan,
    bundle.items,
    bundle.profiles,
    timing.secondsPerReview,
  );
  const itemsPreview = await loadItemsPreview(supabase, bundle.items.slice(0, 12));
  return {
    plan,
    forecast: forecastDto(forecast),
    items_preview: itemsPreview,
    today: todayDto(bundle.plan, timing, eligibleQueueCount(bundle)),
  };
}

export async function previewCramPlan(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  overrides: {
    deadline_at?: string;
    deadline_timezone?: string;
    target_retention?: number;
    daily_minutes?: number;
  },
) {
  const { bundle, timing } = await loadPlanBundleWithTiming(supabase, userId, planId);
  const plan = {
    ...bundle.plan,
    ...overrides,
  };
  const forecast = buildForecast({ ...bundle, plan }, timing);
  return {
    plan: enrichPlan(plan, bundle.items, bundle.profiles, timing.secondsPerReview),
    forecast: forecastDto(forecast),
  };
}

export async function updateDraftCramPlan(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  input: UpdateCramPlanInput,
) {
  const existing = await loadOwnedPlan(supabase, userId, planId);
  if (existing.status !== "draft") {
    throw new CramServiceError("Only draft Cram Plans can change settings", 409);
  }
  const deadline = input.deadline_at ?? existing.deadline_at;
  if (new Date(deadline).getTime() <= Date.now()) {
    throw new CramServiceError("Deadline must be in the future", 400);
  }

  let replacement: Awaited<ReturnType<typeof buildCramSnapshot>> | null = null;
  if (input.selection_spec) {
    replacement = await buildCramSnapshot(
      supabase,
      userId,
      planId,
      input.selection_spec,
    );
    if (replacement.items.length === 0) {
      throw new CramServiceError("Selection did not resolve to any owned cards", 400);
    }
  }

  const update = { ...input };
  const { error } = await supabase
    .from("cram_plans")
    .update(update)
    .eq("id", planId)
    .eq("user_id", userId)
    .eq("status", "draft");
  if (error) throw new CramServiceError(error.message);

  if (replacement) {
    const [{ error: itemDeleteError }, { error: profileDeleteError }] = await Promise.all([
      supabase.from("cram_plan_items").delete().eq("plan_id", planId),
      supabase.from("cram_plan_deck_profiles").delete().eq("plan_id", planId),
    ]);
    if (itemDeleteError) throw new CramServiceError(itemDeleteError.message);
    if (profileDeleteError) throw new CramServiceError(profileDeleteError.message);
    await persistSnapshot(supabase, replacement.items, replacement.profiles);
  }

  return getCramPlanDetail(supabase, userId, planId);
}

const ALLOWED_TRANSITIONS: Record<
  "start" | "pause" | "resume" | "complete" | "archive" | "unarchive",
  CramPlanStatus[]
> = {
  start: ["draft"],
  pause: ["active"],
  resume: ["paused"],
  complete: ["active", "paused"],
  archive: ["draft", "active", "paused", "completed"],
  unarchive: ["archived"],
};

function statusBeforeArchive(plan: {
  started_at: string | null;
  paused_at: string | null;
  completed_at: string | null;
}): Exclude<CramPlanStatus, "archived"> {
  if (plan.completed_at) return "completed";
  if (plan.paused_at) return "paused";
  if (plan.started_at) return "active";
  return "draft";
}

export async function transitionCramPlan(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  action: keyof typeof ALLOWED_TRANSITIONS,
) {
  const plan = await loadOwnedPlan(supabase, userId, planId);
  if (!ALLOWED_TRANSITIONS[action].includes(plan.status)) {
    throw new CramServiceError(
      `Cannot ${action} a ${plan.status} Cram Plan`,
      409,
    );
  }
  if ((action === "start" || action === "resume") && new Date(plan.deadline_at) <= new Date()) {
    throw new CramServiceError("Cannot study a Cram Plan past its deadline", 409);
  }
  if (action === "start") {
    const { count } = await supabase
      .from("cram_plan_items")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", planId);
    if (!count) throw new CramServiceError("Cram Plan has no items", 409);
  }

  const now = new Date().toISOString();
  const changes: Record<string, unknown> =
    action === "start"
      ? { status: "active", started_at: now }
      : action === "pause"
        ? { status: "paused", paused_at: now }
        : action === "resume"
          ? { status: "active", paused_at: null }
          : action === "complete"
            ? { status: "completed", completed_at: now }
            : action === "unarchive"
              ? { status: statusBeforeArchive(plan), archived_at: null }
              : { status: "archived", archived_at: now };
  const { error } = await supabase
    .from("cram_plans")
    .update(changes)
    .eq("id", planId)
    .eq("user_id", userId)
    .eq("status", plan.status);
  if (error) throw new CramServiceError(error.message);
  return getCramPlanDetail(supabase, userId, planId);
}

export async function deleteDraftCramPlan(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
) {
  const plan = await loadOwnedPlan(supabase, userId, planId);
  if (plan.status !== "draft") {
    throw new CramServiceError("Only draft Cram Plans can be deleted", 409);
  }
  const { error } = await supabase
    .from("cram_plans")
    .delete()
    .eq("id", planId)
    .eq("user_id", userId)
    .eq("status", "draft");
  if (error) throw new CramServiceError(error.message);
}

export async function getCramQueue(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  options: { limit: number; continuePastBudget: boolean },
) {
  const now = new Date();
  const { bundle, timing } = await loadPlanBundleWithTiming(supabase, userId, planId, now);
  if (bundle.plan.status !== "active") {
    throw new CramServiceError("Cram Plan is not active", 409);
  }
  const paramsByProject = profileMap(bundle.profiles);
  const deadline = new Date(bundle.plan.deadline_at);
  const sorted = sortCramQueue(
    bundle.items,
    now,
    deadline,
    bundle.plan.target_retention,
    paramsByProject,
  ).filter(
    (item) =>
      item.state === 0 ||
      new Date(item.due).getTime() <= now.getTime() ||
      retrievabilityAt(
        item,
        deadline,
        paramsByProject.get(item.project_id),
        bundle.plan.target_retention,
      ) < bundle.plan.target_retention,
  );
  const remainingBudget = Math.max(
    0,
    Math.min(
      timing.today.reviewCapacity - timing.today.reviewsCompleted,
      Math.floor(
        Math.max(0, bundle.plan.daily_minutes * 60_000 - timing.today.responseMs) /
          (timing.secondsPerReview * 1000),
      ),
    ),
  );
  const take = options.continuePastBudget
    ? options.limit
    : Math.min(options.limit, remainingBudget);
  const selected = sorted.slice(0, take);
  const cardsById = await loadCardsById(
    supabase,
    [...new Set(selected.map((item) => item.card_id))],
  );
  const cards = selected.flatMap((item) => {
    const card = cardsById.get(item.card_id);
    return card ? [queueCardDto(item, card, bundle.plan, paramsByProject)] : [];
  });
  const readiness = calculateReadiness(
    bundle.items,
    deadline,
    bundle.plan.target_retention,
    paramsByProject,
  );
  const today = todayDto(bundle.plan, timing, sorted.length);
  const due = bundle.items.filter(
    (item) => item.state !== 0 && new Date(item.due).getTime() <= now.getTime(),
  ).length;
  const unseen = bundle.items.filter((item) => item.state === 0).length;

  return {
    plan: enrichPlan(
      bundle.plan,
      bundle.items,
      bundle.profiles,
      timing.secondsPerReview,
    ),
    cards,
    queue: cards,
    items: cards,
    counts: {
      total: bundle.items.length,
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

export async function recordCramReview(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  input: { item_id: string; rating: FsrsGrade; response_ms: number },
) {
  // The plan, item, and profile fetches are independent; run them together
  // and validate plan status afterwards to keep grading latency low.
  const [plan, { data: itemData, error: itemError }, { data: profileData }] =
    await Promise.all([
      loadOwnedPlan(supabase, userId, planId),
      supabase
        .from("cram_plan_items")
        .select(ITEM_SELECT)
        .eq("id", input.item_id)
        .eq("plan_id", planId)
        .single(),
      supabase
        .from("cram_plan_deck_profiles")
        .select("plan_id, project_id, fsrs_params")
        .eq("plan_id", planId),
    ]);
  if (plan.status !== "active") {
    throw new CramServiceError("Cram Plan is not active", 409);
  }
  if (itemError || !itemData) {
    throw new CramServiceError("Cram Plan item not found", 404);
  }
  const item = itemData as unknown as CramPlanItemRow;
  const profiles = normalizeProfiles(profileData ?? []);
  const params = profileMap(profiles).get(item.project_id);
  const reviewedAt = new Date();
  const transition = gradeCramItem(
    item,
    input.rating,
    reviewedAt,
    plan.target_retention,
    params,
  );
  const { data: rpcData, error: rpcError } = await supabase.rpc("record_cram_review", {
    p_plan_id: planId,
    p_item_id: item.id,
    p_rating: input.rating,
    p_expected_version: item.version,
    p_next_state: transition.next,
    p_log: transition.log,
    p_response_ms: input.response_ms,
  });
  if (rpcError) {
    const conflict = rpcError.code === "40001" || /changed/i.test(rpcError.message);
    throw new CramServiceError(
      conflict ? "This Cram item was already reviewed; refresh the queue" : rpcError.message,
      conflict ? 409 : 500,
    );
  }
  const timing = await loadPlanTiming(supabase, plan);
  return {
    item_id: item.id,
    previous_state: item,
    next_state: transition.next,
    log: transition.log,
    intervals: transition.intervals,
    version:
      ((rpcData as Array<{ new_version?: number }> | null)?.[0]?.new_version ??
        item.version + 1),
    today: todayDto(plan, timing),
  };
}

async function loadOwnedPlan(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
): Promise<CramPlanRow> {
  const { data, error } = await supabase
    .from("cram_plans")
    .select(PLAN_SELECT)
    .eq("id", planId)
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new CramServiceError("Cram Plan not found", 404);
  return normalizePlan(data);
}

async function loadPlanBundle(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
): Promise<PlanBundle> {
  const plan = await loadOwnedPlan(supabase, userId, planId);
  const [items, { data: profileData, error: profileError }] = await Promise.all([
    loadPlanItems(supabase, [planId]),
    supabase
      .from("cram_plan_deck_profiles")
      .select("plan_id, project_id, fsrs_params")
      .eq("plan_id", planId),
  ]);
  if (profileError) throw new CramServiceError(profileError.message);
  return {
    plan,
    items,
    profiles: normalizeProfiles(profileData ?? []),
  };
}

/**
 * Load a plan plus its items, deck profiles, and today's review timing in two
 * round-trips: the plan row first, then everything else in parallel.
 */
async function loadPlanBundleWithTiming(
  supabase: SupabaseClient,
  userId: string,
  planId: string,
  now = new Date(),
): Promise<{ bundle: PlanBundle; timing: PlanTiming }> {
  const plan = await loadOwnedPlan(supabase, userId, planId);
  const [items, { data: profileData, error: profileError }, timing] = await Promise.all([
    loadPlanItems(supabase, [planId]),
    supabase
      .from("cram_plan_deck_profiles")
      .select("plan_id, project_id, fsrs_params")
      .eq("plan_id", planId),
    loadPlanTiming(supabase, plan, now),
  ]);
  if (profileError) throw new CramServiceError(profileError.message);
  return {
    bundle: {
      plan,
      items,
      profiles: normalizeProfiles(profileData ?? []),
    },
    timing,
  };
}

/**
 * Load every item for the given plans, paging past PostgREST's per-request
 * row cap (1000 by default). A single large plan — or a user with several
 * plans — can easily exceed the cap, which previously truncated the item set
 * and silently skewed readiness, forecasts, and queue building.
 */
async function loadPlanItems(
  supabase: SupabaseClient,
  planIds: string[],
): Promise<CramPlanItemRow[]> {
  const pageSize = 1_000;
  // Fetch each plan's items independently so the requests run in parallel.
  // Most plans fit in a single page, so this usually costs one round-trip
  // total instead of one per 1000 rows across the combined set.
  const perPlan = await Promise.all(
    planIds.map(async (planId) => {
      const items: CramPlanItemRow[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await supabase
          .from("cram_plan_items")
          .select(ITEM_SELECT)
          .eq("plan_id", planId)
          .order("id")
          .range(offset, offset + pageSize - 1);
        if (error) throw new CramServiceError(error.message);
        const rows = (data ?? []) as unknown as CramPlanItemRow[];
        items.push(...rows);
        if (rows.length < pageSize) break;
      }
      return items;
    }),
  );
  return perPlan.flat();
}

function normalizePlan(raw: unknown): CramPlanRow {
  const row = raw as CramPlanRow;
  return {
    ...row,
    target_retention: Number(row.target_retention),
    daily_minutes: Number(row.daily_minutes),
    estimated_seconds_per_review: Number(row.estimated_seconds_per_review ?? 20),
    selection_spec: normalizeSelectionSpec(
      (row.selection_spec ?? {}) as Partial<CramSelectionSpec>,
    ),
  };
}

function normalizeProfiles(rows: unknown[]): CramPlanDeckProfileRow[] {
  return rows.flatMap((raw) => {
    const row = raw as {
      plan_id?: string;
      project_id?: string;
      fsrs_params?: unknown;
    };
    if (!row.plan_id || !row.project_id || !Array.isArray(row.fsrs_params)) return [];
    const params = row.fsrs_params.filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    return [{ plan_id: row.plan_id, project_id: row.project_id, fsrs_params: params }];
  });
}

function profileMap(profiles: CramPlanDeckProfileRow[]) {
  return new Map(profiles.map((profile) => [profile.project_id, profile.fsrs_params]));
}

/** Count of items currently eligible for the study queue (due, new, or at risk). */
function eligibleQueueCount(bundle: PlanBundle, now = new Date()): number {
  const deadline = new Date(bundle.plan.deadline_at);
  const params = profileMap(bundle.profiles);
  let count = 0;
  for (const item of bundle.items) {
    if (
      item.state === 0 ||
      new Date(item.due).getTime() <= now.getTime() ||
      retrievabilityAt(
        item,
        deadline,
        params.get(item.project_id),
        bundle.plan.target_retention,
      ) < bundle.plan.target_retention
    ) {
      count++;
    }
  }
  return count;
}

function buildForecast(
  bundle: PlanBundle,
  timing: Awaited<ReturnType<typeof loadPlanTiming>>,
): CramForecast {
  return forecastCramPlan({
    items: bundle.items,
    deadline: new Date(bundle.plan.deadline_at),
    deadlineTimezone: bundle.plan.deadline_timezone,
    targetRetention: bundle.plan.target_retention,
    dailyMinutes: bundle.plan.daily_minutes,
    estimatedSecondsPerReview: timing.secondsPerReview,
    reviewsCompletedToday: timing.today.reviewsCompleted,
    paramsByProject: profileMap(bundle.profiles),
  });
}

function forecastDto(forecast: CramForecast) {
  return {
    ...forecast,
    readiness_detail: forecast.readiness,
    readiness: forecast.readiness.mean_retrievability,
    readiness_score: forecast.readiness.mean_retrievability,
    target_coverage: forecast.readiness.target_coverage,
    total_cards: forecast.item_count,
    cards_selected: forecast.item_count,
    cards_due_today: forecast.due_count,
    reviews_per_day: forecast.daily_review_capacity,
    estimated_daily_minutes: forecast.daily_review_capacity
      ? Math.round(
          (forecast.daily_review_capacity * forecast.estimated_seconds_per_review) / 60,
        )
      : 0,
  };
}

function enrichPlan(
  plan: CramPlanRow,
  items: CramPlanItemRow[],
  profiles: CramPlanDeckProfileRow[],
  secondsPerReview: number,
) {
  const readiness = calculateReadiness(
    items,
    new Date(plan.deadline_at),
    plan.target_retention,
    profileMap(profiles),
  );
  return {
    ...plan,
    timezone: plan.deadline_timezone,
    desired_retention: plan.target_retention,
    retention: plan.target_retention,
    estimated_seconds_per_review: secondsPerReview,
    item_count: items.length,
    card_count: new Set(items.map((item) => item.card_id)).size,
    readiness: readiness.mean_retrievability,
    readiness_score: readiness.mean_retrievability,
    target_coverage: readiness.target_coverage,
    counts: {
      total: items.length,
      new: readiness.unseen_items,
      reviewed: items.length - readiness.unseen_items,
    },
  };
}

async function persistSnapshot(
  supabase: SupabaseClient,
  items: CramPlanItemInsert[],
  profiles: CramPlanDeckProfileRow[],
) {
  for (let index = 0; index < items.length; index += 500) {
    const { error } = await supabase
      .from("cram_plan_items")
      .insert(items.slice(index, index + 500));
    if (error) throw new CramServiceError(error.message);
  }
  if (profiles.length > 0) {
    const { error } = await supabase.from("cram_plan_deck_profiles").insert(profiles);
    if (error) throw new CramServiceError(error.message);
  }
}

async function loadItemsPreview(
  supabase: SupabaseClient,
  items: CramPlanItemRow[],
) {
  const cardIds = [...new Set(items.map((item) => item.card_id))];
  if (cardIds.length === 0) return [];
  const [cardsById, projectResult] = await Promise.all([
    loadCardsById(supabase, cardIds),
    supabase
      .from("projects")
      .select("id, name, deck_name")
      .in("id", [...new Set(items.map((item) => item.project_id))]),
  ]);
  const projectNames = new Map(
    (projectResult.data ?? []).map((project) => [
      project.id,
      project.deck_name || project.name,
    ]),
  );
  return items.flatMap((item) => {
    const card = cardsById.get(item.card_id);
    if (!card) return [];
    return [{
      id: item.id,
      item_id: item.id,
      card_id: item.card_id,
      cloze_ord:
        card.type === "cloze" || card.type === "image-occlusion"
          ? item.cloze_ord
          : null,
      type: card.type,
      front: card.front ?? card.cloze_text,
      deck_name: projectNames.get(item.project_id) ?? null,
      tags: card.tags,
    }];
  });
}

async function loadCardsById(
  supabase: SupabaseClient,
  cardIds: string[],
): Promise<Map<string, CramCardRow>> {
  if (cardIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("cards")
    .select(
      "id, source_chunk_id, type, front, back, cloze_text, extra, occlusion_data, tags, sort_order, generation_jobs!inner(sources!inner(id, project_id))",
    )
    .in("id", cardIds);
  if (error) throw new CramServiceError(error.message);
  const cards = (data ?? []).flatMap((raw): CramCardRow[] => {
    const row = raw as unknown as {
      id: string;
      source_chunk_id: string | null;
      type: CramCardRow["type"];
      front: string | null;
      back: string | null;
      cloze_text: string | null;
      extra: string | null;
      occlusion_data: unknown;
      tags: string[] | null;
      sort_order: number;
      generation_jobs: { sources: { id: string; project_id: string } | Array<{ id: string; project_id: string }> } | Array<{ sources: { id: string; project_id: string } | Array<{ id: string; project_id: string }> }>;
    };
    const job = Array.isArray(row.generation_jobs)
      ? row.generation_jobs[0]
      : row.generation_jobs;
    const source = Array.isArray(job?.sources) ? job.sources[0] : job?.sources;
    if (!source) return [];
    return [{
      id: row.id,
      project_id: source.project_id,
      source_id: source.id,
      source_chunk_id: row.source_chunk_id,
      type: row.type,
      front: row.front,
      back: row.back,
      cloze_text: row.cloze_text,
      extra: row.extra,
      occlusion_data: row.occlusion_data ?? null,
      tags: row.tags ?? [],
      sort_order: row.sort_order,
    }];
  });
  return new Map(cards.map((card) => [card.id, card]));
}

function queueCardDto(
  item: CramPlanItemRow,
  card: CramCardRow,
  plan: CramPlanRow,
  paramsByProject: ReadonlyMap<string, number[]>,
): CramQueueCard {
  const scheduler = buildCramScheduler(
    paramsByProject.get(item.project_id),
    plan.target_retention,
  );
  return {
    item_id: item.id,
    id: item.card_id,
    queue_key: cramQueueKey(item.card_id, card.type, item.cloze_ord),
    cloze_ord:
      card.type === "cloze" || card.type === "image-occlusion"
        ? item.cloze_ord
        : null,
    type: card.type,
    front: card.front,
    back: card.back,
    cloze_text: card.cloze_text,
    extra: card.extra,
    occlusion_data: card.occlusion_data,
    tags: card.tags,
    state: item.state,
    due: item.due,
    reps: item.reps,
    lapses: item.lapses,
    is_new: item.state === 0,
    intervals: previewIntervals(scheduler, rowToCard(item), new Date()),
  };
}

async function loadPlanTiming(
  supabase: SupabaseClient,
  plan: CramPlanRow,
  now = new Date(),
) {
  const dayStart = startOfLocalDay(now, plan.deadline_timezone);
  const dayEnd = nextLocalDayStart(dayStart, plan.deadline_timezone);
  const [recentResult, todayResult] = await Promise.all([
    supabase
      .from("cram_review_logs")
      .select("response_ms")
      .eq("plan_id", plan.id)
      .not("response_ms", "is", null)
      .order("review", { ascending: false })
      .limit(101),
    supabase
      .from("cram_review_logs")
      .select("response_ms")
      .eq("plan_id", plan.id)
      .gte("review", dayStart.toISOString())
      .lt("review", dayEnd.toISOString()),
  ]);
  if (recentResult.error) throw new CramServiceError(recentResult.error.message);
  if (todayResult.error) throw new CramServiceError(todayResult.error.message);
  const recentMs = (recentResult.data ?? []).flatMap((row) =>
    typeof row.response_ms === "number" ? [row.response_ms] : [],
  );
  const todayMs = (todayResult.data ?? []).flatMap((row) =>
    typeof row.response_ms === "number" ? [row.response_ms] : [],
  );
  const secondsPerReview = estimatedSecondsPerReview(
    recentMs,
    plan.estimated_seconds_per_review || 20,
  );
  return {
    secondsPerReview,
    today: {
      reviewsCompleted: (todayResult.data ?? []).length,
      responseMs: todayMs.reduce((sum, value) => sum + value, 0),
      reviewCapacity: reviewCapacity(plan.daily_minutes, secondsPerReview),
    },
  };
}

function todayDto(
  plan: CramPlanRow,
  timing: Awaited<ReturnType<typeof loadPlanTiming>>,
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
