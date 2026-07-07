import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import {
  FSRSBindingItem,
  FSRSBindingReview,
  computeParameters,
} from "@open-spaced-repetition/binding";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FSRS_PARAM_COUNT } from "@/lib/fsrs/scheduler";
import { OPTIMIZER_MIN_LOGS } from "@/lib/fsrs/optimizer-config";
import { buildTrainingItems, type TrainingLogRow } from "@/lib/fsrs/training-items";

export const runtime = "nodejs";
// Optimizer can run for tens of seconds on large histories — keep it well
// inside Vercel's Pro 300s ceiling but generous enough for ~50k reviews.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_LOGS = 50_000;

/**
 * Fit FSRS weights to the current user's review_logs and persist them in
 * public.user_fsrs_params. Subsequent scheduling calls
 * (`buildScheduler({ w: userParams })`) will use the personalized weights.
 *
 *   POST /api/fsrs/optimize
 */
export const POST = withApiTiming(async function POST() {
  const { user, response } = await requireUser();
  if (response) return response;

  const supabase = await createClient();

  // Pull review logs in chronological order. We cap at MAX_LOGS so worst-case
  // memory + runtime stay bounded inside the function timeout.
  const { data: logs, error } = await supabase
    .from("review_logs")
    .select("card_id, cloze_ord, rating, review")
    .eq("user_id", user!.id)
    .order("review", { ascending: true })
    .limit(MAX_LOGS);

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

  // Build cumulative training snapshots via the shared builder (same logic the
  // profile readiness meter uses). Only FSRS grades 1–4 count, ordinals stay
  // separate, and each snapshot carries at least one real (delta_t > 0)
  // interval. That last guard is CRITICAL: fsrs-rs panics on any item whose
  // reviews are *all* delta_t == 0 ("at least one review with delta_t > 0 is
  // required"), and the panic cannot unwind — it aborts the whole serverless
  // process, so the browser just sees "failed to fetch".
  const items: FSRSBindingItem[] = buildTrainingItems(rows).map(
    (reviews) =>
      new FSRSBindingItem(reviews.map((r) => new FSRSBindingReview(r.rating, r.deltaT))),
  );

  if (items.length < OPTIMIZER_MIN_LOGS) {
    return NextResponse.json(
      {
        error: `Not enough review history with real intervals yet (have ${items.length} usable training items). Keep reviewing across multiple days and try again.`,
        log_count: items.length,
      },
      { status: 400 },
    );
  }

  let params: number[];
  try {
    const fitted = await computeParameters(items, {
      enableShortTerm: true,
      numRelearningSteps: 1,
    });
    params = Array.from(fitted);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Optimizer failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (params.length !== FSRS_PARAM_COUNT) {
    return NextResponse.json(
      { error: `Optimizer returned ${params.length} params, expected ${FSRS_PARAM_COUNT}` },
      { status: 500 },
    );
  }

  const { error: upsertError } = await supabase
    .from("user_fsrs_params")
    .upsert(
      {
        user_id: user!.id,
        params,
        log_count: rows.length,
        optimized_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    log_count: rows.length,
    training_items: items.length,
    params,
  });
}, "POST /api/fsrs/optimize");
