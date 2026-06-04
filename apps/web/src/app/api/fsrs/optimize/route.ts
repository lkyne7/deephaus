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
    .select("card_id, rating, review")
    .eq("user_id", user!.id)
    .order("review", { ascending: true })
    .limit(MAX_LOGS);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (logs ?? []) as Array<{ card_id: string; rating: number; review: string }>;
  if (rows.length < OPTIMIZER_MIN_LOGS) {
    return NextResponse.json(
      {
        error: `Need at least ${OPTIMIZER_MIN_LOGS} reviews to optimize (you have ${rows.length}).`,
        log_count: rows.length,
      },
      { status: 400 },
    );
  }

  // Group reviews by card in chronological order. Only FSRS grades 1–4
  // (again/hard/good/easy) are valid training input; anything else (e.g. a
  // manual reschedule logged with a sentinel rating) is dropped so it can't
  // reach the native optimizer.
  const byCard = new Map<string, Array<{ rating: number; review: Date }>>();
  for (const r of rows) {
    if (r.rating < 1 || r.rating > 4) continue;
    const when = new Date(r.review);
    if (Number.isNaN(when.getTime())) continue;
    const list = byCard.get(r.card_id) ?? [];
    list.push({ rating: r.rating, review: when });
    byCard.set(r.card_id, list);
  }

  // Build cumulative FSRSItem snapshots. CRITICAL: fsrs-rs panics on any item
  // whose reviews are *all* delta_t == 0 ("at least one review with delta_t > 0
  // is required"), and that panic cannot unwind — it aborts the entire Node /
  // serverless process, dropping the response so the browser sees "failed to
  // fetch". Same-day reviews (learning steps, lapses) routinely round to
  // delta_t 0, so we only emit a snapshot once the card's history contains at
  // least one real (delta_t > 0) interval.
  const items: FSRSBindingItem[] = [];
  for (const reviews of byCard.values()) {
    if (reviews.length < 2) continue;
    const cumulative: FSRSBindingReview[] = [];
    let hasLongTermReview = false;
    for (let i = 0; i < reviews.length; i++) {
      const rawDelta =
        i === 0 ? 0 : Math.round(daysBetween(reviews[i - 1].review, reviews[i].review));
      // First review's delta_t must be 0; clamp negatives/NaN from clock skew.
      const deltaT = i === 0 || !Number.isFinite(rawDelta) ? 0 : Math.max(0, rawDelta);
      cumulative.push(new FSRSBindingReview(reviews[i].rating, deltaT));
      if (deltaT > 0) hasLongTermReview = true;
      if (i >= 1 && hasLongTermReview) {
        items.push(new FSRSBindingItem([...cumulative]));
      }
    }
  }

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

function daysBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / 86_400_000;
}
