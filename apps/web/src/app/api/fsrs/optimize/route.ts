import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import {
  FSRSBindingItem,
  FSRSBindingReview,
  computeParameters,
  convertCsvToFsrsItemsWithCardIds,
} from "@open-spaced-repetition/binding";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  FSRS6_PARAM_COUNT,
  FSRS7_PARAM_COUNT,
  clearUserWeightsCache,
} from "@/lib/fsrs/scheduler";
import { OPTIMIZER_MIN_LOGS } from "@/lib/fsrs/optimizer-config";
import {
  buildFsrs7TrainingCsv,
  buildTrainingItems,
  countUsableTrainingItems,
  type TrainingLogRow,
} from "@/lib/fsrs/training-items";
import { loadGlobalStudySettings } from "@/lib/fsrs/user-study-settings";

export const runtime = "nodejs";
// Optimizer can run for tens of seconds on large histories — keep it well
// inside Vercel's Pro 300s ceiling but generous enough for ~50k reviews.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_LOGS = 50_000;
/** How often the binding checks whether training has finished. */
const TRAINING_POLL_MS = 100;

/**
 * Fit FSRS-7 weights to the current user's review_logs and persist them in
 * public.user_fsrs_params. Subsequent scheduling calls
 * (`buildScheduler({ weights })`) will use the personalized weights.
 *
 * Cards whose history cannot be rebuilt stay on FSRS-6, so its weights are
 * refreshed in the same run when there is enough whole-day history for them.
 *
 *   POST /api/fsrs/optimize
 */
export const POST = withApiTiming(async function POST() {
  const { user, response } = await requireUser();
  if (response) return response;

  const supabase = await createClient();

  // Pull review logs in chronological order. We cap at MAX_LOGS so worst-case
  // memory + runtime stay bounded inside the function timeout.
  const [{ data: logs, error }, studySettings] = await Promise.all([
    supabase
      .from("review_logs")
      .select("card_id, cloze_ord, rating, state, review")
      .eq("undone", false)
      .eq("user_id", user!.id)
      .order("review", { ascending: true })
      .limit(MAX_LOGS),
    loadGlobalStudySettings(supabase, user!.id),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (logs ?? []) as TrainingLogRow[];
  if (rows.length < OPTIMIZER_MIN_LOGS) {
    return NextResponse.json(
      {
        error: `Need at least ${OPTIMIZER_MIN_LOGS} reviews to optimize (you have ${rows.length}).`,
        log_count: rows.length,
      },
      { status: 400 },
    );
  }

  // The same count the profile readiness meter shows, so the two never disagree.
  const usableItems = countUsableTrainingItems(rows);
  if (usableItems < OPTIMIZER_MIN_LOGS) {
    return NextResponse.json(
      {
        error: `Not enough review history yet (have ${usableItems} usable training items). Keep reviewing and try again.`,
        log_count: usableItems,
      },
      { status: 400 },
    );
  }

  let fsrs7Params: number[];
  let trainingItems: number;
  try {
    const csv = buildFsrs7TrainingCsv(rows);
    // Elapsed time is measured in the user's study days (rollover hour and
    // timezone), the same days the scheduler works in.
    const dataset = convertToItems(csv, studySettings.dayStartHour, studySettings.timezone);
    trainingItems = dataset.items.length;
    const fitted = await computeParameters(dataset.items, {
      modelVersion: "FSRS-7",
      enableShortTerm: true,
      cardIds: dataset.cardIds,
      timeout: TRAINING_POLL_MS,
    });
    fsrs7Params = Array.from(fitted);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Optimizer failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (fsrs7Params.length !== FSRS7_PARAM_COUNT || !fsrs7Params.every(Number.isFinite)) {
    return NextResponse.json(
      { error: `Optimizer returned ${fsrs7Params.length} params, expected ${FSRS7_PARAM_COUNT}` },
      { status: 500 },
    );
  }

  const optimizedAt = new Date().toISOString();
  const fsrs6Params = await fitFsrs6(rows);
  const { error: upsertError } = await supabase.from("user_fsrs_params").upsert(
    {
      user_id: user!.id,
      fsrs7_params: fsrs7Params,
      fsrs7_log_count: rows.length,
      fsrs7_optimized_at: optimizedAt,
      ...(fsrs6Params
        ? { params: fsrs6Params, log_count: rows.length, optimized_at: optimizedAt }
        : {}),
    },
    { onConflict: "user_id" },
  );
  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }
  clearUserWeightsCache(user!.id);

  return NextResponse.json({
    ok: true,
    model: "FSRS-7",
    log_count: rows.length,
    training_items: trainingItems,
    params: fsrs7Params,
  });
}, "POST /api/fsrs/optimize");

function convertToItems(csv: Uint8Array, dayStartHour: number, timezone: string | null) {
  try {
    return convertCsvToFsrsItemsWithCardIds(csv, dayStartHour, timezone ?? "UTC", "FSRS-7");
  } catch (error) {
    // An unknown saved timezone must not block optimization.
    if (!timezone || timezone === "UTC") throw error;
    return convertCsvToFsrsItemsWithCardIds(csv, dayStartHour, "UTC", "FSRS-7");
  }
}

/**
 * FSRS-6 weights for the cards still on that model, or null when there is too
 * little whole-day history (the previous fit, if any, is kept).
 *
 * Only FSRS grades 1–4 count, ordinals stay separate, and each snapshot
 * carries at least one real (delta_t > 0) interval. That last guard is
 * CRITICAL: fsrs-rs panics on any FSRS-6 item whose reviews are *all*
 * delta_t == 0 ("at least one review with delta_t > 0 is required"), and the
 * panic cannot unwind — it aborts the whole serverless process, so the
 * browser just sees "failed to fetch".
 */
async function fitFsrs6(rows: TrainingLogRow[]): Promise<number[] | null> {
  const items: FSRSBindingItem[] = buildTrainingItems(rows).map(
    (reviews) =>
      new FSRSBindingItem(reviews.map((r) => new FSRSBindingReview(r.rating, r.deltaT))),
  );
  if (items.length < OPTIMIZER_MIN_LOGS) return null;
  try {
    const fitted = Array.from(
      await computeParameters(items, {
        modelVersion: "FSRS-6",
        enableShortTerm: true,
        numRelearningSteps: 1,
        timeout: TRAINING_POLL_MS,
      }),
    );
    return fitted.length === FSRS6_PARAM_COUNT && fitted.every(Number.isFinite) ? fitted : null;
  } catch (error) {
    console.warn("[fsrs optimize] FSRS-6 fit skipped", error instanceof Error ? error.message : error);
    return null;
  }
}
