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

  // Group reviews by card and build cumulative FSRSItem snapshots. The
  // optimizer rejects items whose only review has delta_t == 0, so we skip
  // the first snapshot of each card and start at the second review onward.
  const byCard = new Map<string, Array<{ rating: number; review: Date }>>();
  for (const r of rows) {
    const list = byCard.get(r.card_id) ?? [];
    list.push({ rating: r.rating, review: new Date(r.review) });
    byCard.set(r.card_id, list);
  }

  const items: FSRSBindingItem[] = [];
  for (const reviews of byCard.values()) {
    if (reviews.length < 2) continue;
    const cumulative: FSRSBindingReview[] = [];
    for (let i = 0; i < reviews.length; i++) {
      const deltaT =
        i === 0 ? 0 : Math.max(0, Math.round(daysBetween(reviews[i - 1].review, reviews[i].review)));
      cumulative.push(new FSRSBindingReview(reviews[i].rating, deltaT));
      if (i >= 1) {
        items.push(new FSRSBindingItem([...cumulative]));
      }
    }
  }

  if (items.length < OPTIMIZER_MIN_LOGS) {
    return NextResponse.json(
      {
        error: `Not enough multi-review cards yet (have ${items.length} usable training items).`,
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
