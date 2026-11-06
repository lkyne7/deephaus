import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { z } from "zod";
import { invalidateUserStudyCaches } from "@/lib/cache/invalidate";
import { requireAuth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  type CardReviewRow,
  type FsrsGrade,
  buildScheduler,
  formatInterval,
  gradeToRating,
  isValidGrade,
  loadReviewHistories,
  loadUserWeights,
  resolveWeights,
  reviewHistoryKey,
} from "@/lib/fsrs/scheduler";
import { loadDeckSettings } from "@/lib/fsrs/settings";

const bodySchema = z.union([
  z.object({
    rating: z.number().int().min(1).max(4),
    cloze_ord: z.number().int().min(0).max(9).optional(),
    client_mutation_id: z.string().uuid().optional(),
    answered_at: z.string().datetime().optional(),
    raw_answered_at: z.string().datetime().optional(),
  }),
  z.object({
    grade: z.enum(["again", "hard", "good", "easy"]),
    cloze_ord: z.number().int().min(0).max(9).optional(),
    client_mutation_id: z.string().uuid().optional(),
    answered_at: z.string().datetime().optional(),
    raw_answered_at: z.string().datetime().optional(),
  }),
]);

/**
 * Submit a study rating for one card. Loads the user's FSRS state, review
 * history and per-user weights, runs the scheduler with the given rating,
 * persists the new state to card_reviews, and appends a row to review_logs.
 * Returns the updated state + the next predicted intervals.
 *
 *   POST /api/cards/{cardId}/review
 *   { "rating": 3 }     // 1=Again, 2=Hard, 3=Good, 4=Easy
 *   { "grade": "good" } // alternative
 */
export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  const { id: cardId } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  let rating: FsrsGrade;
  if ("rating" in body) {
    if (!isValidGrade(body.rating)) {
      return NextResponse.json({ error: "Invalid rating" }, { status: 400 });
    }
    rating = body.rating;
  } else {
    rating = gradeToRating(body.grade);
  }

  const clozeOrd =
    "cloze_ord" in body && body.cloze_ord != null ? body.cloze_ord : 0;

  const [cardResult, existingResult, userWeights, histories] = await Promise.all([
    supabase
      .from("cards")
      .select(
        "id, generation_jobs!inner(sources!inner(projects!inner(id, user_id, settings)))",
      )
      .eq("id", cardId)
      .single(),
    supabase
      .from("card_reviews")
      .select(
        "due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps, stability_fast, fsrs_version, version",
      )
      .eq("card_id", cardId)
      .eq("user_id", user!.id)
      .eq("cloze_ord", clozeOrd)
      .maybeSingle(),
    loadUserWeights(supabase, user!.id),
    // The card's own history lets the scheduler rebuild its FSRS-7 memory.
    loadReviewHistories(supabase, user!.id, [cardId]),
  ]);

  const { data: cardRow } = cardResult;
  if (!cardRow) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }
  const project = extractProject(cardRow);
  if (!project || project.user_id !== user!.id) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const settings = await loadDeckSettings(supabase, project.id, user!.id);
  const existing = existingResult.data;

  const scheduler = buildScheduler({
    weights: resolveWeights(settings.fsrsParams, userWeights),
    requestRetention: settings.desiredRetention,
    easyDays: settings.easyDays,
    timezone: settings.timezone,
    dayStartHour: settings.dayStartHour,
  });

  const now = new Date(
    Math.min(
      body.answered_at ? Date.parse(body.answered_at) : Date.now(),
      Date.now(),
    ),
  );
  const previousState = existing
    ? (existing as unknown as CardReviewRow)
    : null;
  const cardKey = reviewHistoryKey(cardId, clozeOrd);
  const history = histories.get(cardKey) ?? [];

  // A delayed answer can predate the winning state loaded above; the scheduler
  // keeps elapsed time nonnegative and SQL still orders this event by its
  // answer time.
  const result = scheduler.grade({
    cardKey,
    review: previousState,
    history,
    now,
    rating,
  });
  const reviewFields = result.next;
  const log = result.log;
  const historyWithThisReview = [
    ...history,
    { rating, state: log.state, review: log.review },
  ];

  const mutationId = body.client_mutation_id ?? crypto.randomUUID();
  const logRow = {
    card_id: cardId,
    user_id: user!.id,
    cloze_ord: clozeOrd,
    rating,
    state: log.state,
    due: log.due,
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsed_days,
    last_elapsed_days: log.last_elapsed_days,
    scheduled_days: log.scheduled_days,
    review: log.review,
    raw_review: body.raw_answered_at ?? body.answered_at ?? log.review,
  };

  const intervals = scheduler.previewIntervals({
    cardKey,
    review: reviewFields,
    history: historyWithThisReview,
    now: new Date(reviewFields.due),
  });
  const responsePayload = {
    review_id: mutationId,
    previous_state: previousState,
    next_state: reviewFields,
    log: {
      rating: logRow.rating,
      state: logRow.state,
      due: logRow.due,
      stability: logRow.stability,
      difficulty: logRow.difficulty,
      elapsed_days: logRow.elapsed_days,
      last_elapsed_days: logRow.last_elapsed_days,
      scheduled_days: logRow.scheduled_days,
      review: logRow.review,
    },
    state: reviewFields.state,
    due: reviewFields.due,
    scheduled_days: reviewFields.scheduled_days,
    next_interval: formatInterval(result.intervalDays),
    intervals,
  };

  // One database function owns the state update and history insert. Its
  // mutation UUID doubles as the review log ID, so an ambiguous retry returns
  // the original response instead of applying the FSRS grade twice.
  const service = createServiceClient();
  const { data: storedResponse, error: writeError } = await service.rpc(
    "apply_card_review",
    {
      p_user_id: user!.id,
      p_card_id: cardId,
      p_cloze_ord: clozeOrd,
      p_expected_version: existing ? Number(existing.version ?? 0) : 0,
      p_mutation_id: mutationId,
      p_review: reviewFields,
      p_log: logRow,
      p_response: responsePayload,
    },
  );

  if (writeError) {
    if (writeError.code === "40001") {
      return NextResponse.json(
        {
          error:
            "This card was reviewed elsewhere. Refresh the queue and try again.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: writeError.message }, { status: 500 });
  }

  invalidateUserStudyCaches(user!.id);
  if (
    storedResponse?.reconciliation === "history_only" &&
    storedResponse.next_state
  ) {
    const saved = storedResponse.next_state as CardReviewRow;
    return NextResponse.json({
      ...storedResponse,
      intervals: scheduler.previewIntervals({
        cardKey,
        review: saved,
        history: historyWithThisReview,
        now: new Date(saved.due),
      }),
      next_interval: formatInterval(saved.scheduled_days),
    });
  }
  return NextResponse.json(storedResponse ?? responsePayload);
}, "POST /api/cards/[id]/review");

interface ProjectInfo {
  id: string;
  user_id: string;
  settings: unknown;
}

// Supabase's PostgREST returns deeply joined relations as either a single
// object or an array depending on cardinality. Unwrap both forms.
function extractProject(row: unknown): ProjectInfo | null {
  const r = row as {
    generation_jobs:
      | {
          sources:
            | { projects: ProjectInfo | ProjectInfo[] }
            | { projects: ProjectInfo | ProjectInfo[] }[];
        }
      | {
          sources:
            | { projects: ProjectInfo | ProjectInfo[] }
            | { projects: ProjectInfo | ProjectInfo[] }[];
        }[];
  };
  const gj = Array.isArray(r.generation_jobs)
    ? r.generation_jobs[0]
    : r.generation_jobs;
  if (!gj) return null;
  const src = Array.isArray(gj.sources) ? gj.sources[0] : gj.sources;
  if (!src) return null;
  const proj = Array.isArray(src.projects) ? src.projects[0] : src.projects;
  return proj ?? null;
}
