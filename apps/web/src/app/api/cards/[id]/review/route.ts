import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { z } from "zod";
import { invalidateUserStudyCaches } from "@/lib/cache/invalidate";
import { requireUser } from "@/lib/auth";
import {
  type CardReviewRow,
  type FsrsGrade,
  buildScheduler,
  cardToRowFields,
  emptyCard,
  formatInterval,
  gradeToRating,
  isValidGrade,
  loadUserParams,
  previewIntervals,
  resolveDeckParams,
  rowToCard,
} from "@/lib/fsrs/scheduler";
import { settingsFromRecord } from "@/lib/fsrs/settings";

const bodySchema = z.union([
  z.object({
    rating: z.number().int().min(1).max(4),
    cloze_ord: z.number().int().min(0).max(9).optional(),
  }),
  z.object({
    grade: z.enum(["again", "hard", "good", "easy"]),
    cloze_ord: z.number().int().min(0).max(9).optional(),
  }),
]);

/**
 * Submit a study rating for one card. Loads the user's FSRS state and per-user
 * params, runs ts-fsrs's scheduler with the given rating, persists the new
 * state to card_reviews, and appends a row to review_logs. Returns the
 * updated state + the next predicted intervals.
 *
 *   POST /api/cards/{cardId}/review
 *   { "rating": 3 }     // 1=Again, 2=Hard, 3=Good, 4=Easy
 *   { "grade": "good" } // alternative
 */
export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, supabase, response } = await requireUser();
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

  const clozeOrd = "cloze_ord" in body && body.cloze_ord != null ? body.cloze_ord : 0;

  const [cardResult, existingResult, userParams] = await Promise.all([
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
        "due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps",
      )
      .eq("card_id", cardId)
      .eq("user_id", user!.id)
      .eq("cloze_ord", clozeOrd)
      .maybeSingle(),
    loadUserParams(supabase, user!.id),
  ]);

  const { data: cardRow } = cardResult;
  if (!cardRow) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }
  const project = extractProject(cardRow);
  if (!project || project.user_id !== user!.id) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const settings = settingsFromRecord(project.settings);
  const existing = existingResult.data;

  const scheduler = buildScheduler({
    w: resolveDeckParams(settings.fsrsParams, userParams),
    requestRetention: settings.desiredRetention,
  });

  const now = new Date();
  const fsrsCard = existing ? rowToCard(existing as unknown as CardReviewRow) : emptyCard(now);
  const previousState = existing ? (existing as unknown as CardReviewRow) : null;

  const result = scheduler.next(fsrsCard, now, rating);
  const next = result.card;
  const log = result.log;

  const reviewFields = cardToRowFields(next);
  const logRow = {
    card_id: cardId,
    user_id: user!.id,
    cloze_ord: clozeOrd,
    rating,
    state: log.state as number,
    due: log.due.toISOString(),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsed_days,
    last_elapsed_days: log.last_elapsed_days,
    scheduled_days: log.scheduled_days,
    review: log.review.toISOString(),
  };

  const [{ error: upsertError }, { error: logError }] = await Promise.all([
    supabase.from("card_reviews").upsert(
      { card_id: cardId, user_id: user!.id, cloze_ord: clozeOrd, ...reviewFields },
      { onConflict: "card_id,user_id,cloze_ord" },
    ),
    supabase.from("review_logs").insert(logRow),
  ]);

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }
  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 500 });
  }

  invalidateUserStudyCaches(user!.id);

  const intervals = previewIntervals(scheduler, next, next.due);

  return NextResponse.json({
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
    state: next.state as number,
    due: next.due.toISOString(),
    scheduled_days: next.scheduled_days,
    next_interval: formatInterval(next.scheduled_days),
    intervals,
  });
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
      | { sources: { projects: ProjectInfo | ProjectInfo[] } | { projects: ProjectInfo | ProjectInfo[] }[] }
      | { sources: { projects: ProjectInfo | ProjectInfo[] } | { projects: ProjectInfo | ProjectInfo[] }[] }[];
  };
  const gj = Array.isArray(r.generation_jobs) ? r.generation_jobs[0] : r.generation_jobs;
  if (!gj) return null;
  const src = Array.isArray(gj.sources) ? gj.sources[0] : gj.sources;
  if (!src) return null;
  const proj = Array.isArray(src.projects) ? src.projects[0] : src.projects;
  return proj ?? null;
}
