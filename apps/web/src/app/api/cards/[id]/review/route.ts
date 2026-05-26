import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  type CardReviewRow,
  type FsrsGrade,
  cardToRowFields,
  emptyCard,
  formatInterval,
  getScheduler,
  gradeToRating,
  isValidGrade,
  previewIntervals,
  rowToCard,
} from "@/lib/fsrs/scheduler";

const bodySchema = z.union([
  z.object({ rating: z.number().int().min(1).max(4) }),
  z.object({ grade: z.enum(["again", "hard", "good", "easy"]) }),
]);

/**
 * Submit a study rating for one card. Loads the user's existing FSRS state
 * (or initializes a fresh card), runs ts-fsrs's scheduler with the given
 * rating, persists the new state to card_reviews, and appends a row to
 * review_logs. Returns the updated state + the next predicted intervals so
 * the client UI can stay in sync.
 *
 *   POST /api/cards/{cardId}/review
 *   { "rating": 3 }     // 1=Again, 2=Hard, 3=Good, 4=Easy
 *   { "grade": "good" } // alternative
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
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

  const supabase = await createClient();

  const { data: cardRow } = await supabase
    .from("cards")
    .select(
      "id, generation_jobs!inner(sources!inner(projects!inner(id, user_id)))",
    )
    .eq("id", cardId)
    .single();

  if (!cardRow) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  type AccessJoin = {
    generation_jobs:
      | { sources: { projects: { user_id: string } | { user_id: string }[] } | { projects: { user_id: string } | { user_id: string }[] }[] }
      | { sources: { projects: { user_id: string } | { user_id: string }[] } | { projects: { user_id: string } | { user_id: string }[] }[] }[];
  };
  const ownerId = extractOwnerId(cardRow as unknown as AccessJoin);
  if (ownerId !== user!.id) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("card_reviews")
    .select(
      "due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps",
    )
    .eq("card_id", cardId)
    .eq("user_id", user!.id)
    .maybeSingle();

  const now = new Date();
  const fsrsCard = existing ? rowToCard(existing as unknown as CardReviewRow) : emptyCard(now);

  const result = getScheduler().next(fsrsCard, now, rating);
  const next = result.card;
  const log = result.log;

  const { error: upsertError } = await supabase
    .from("card_reviews")
    .upsert(
      { card_id: cardId, user_id: user!.id, ...cardToRowFields(next) },
      { onConflict: "card_id,user_id" },
    );
  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  await supabase.from("review_logs").insert({
    card_id: cardId,
    user_id: user!.id,
    rating,
    state: log.state as number,
    due: log.due.toISOString(),
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsed_days,
    last_elapsed_days: log.last_elapsed_days,
    scheduled_days: log.scheduled_days,
    review: log.review.toISOString(),
  });

  return NextResponse.json({
    state: next.state as number,
    due: next.due.toISOString(),
    scheduled_days: next.scheduled_days,
    next_interval: formatInterval(next.scheduled_days),
    intervals: previewIntervals(next, next.due),
  });
}

// Supabase's PostgREST returns the deeply joined relations as either a single
// object or an array depending on the relationship cardinality. Unwrap both.
function extractOwnerId(row: {
  generation_jobs:
    | { sources: { projects: { user_id: string } | { user_id: string }[] } | { projects: { user_id: string } | { user_id: string }[] }[] }
    | { sources: { projects: { user_id: string } | { user_id: string }[] } | { projects: { user_id: string } | { user_id: string }[] }[] }[];
}): string | null {
  const gj = Array.isArray(row.generation_jobs) ? row.generation_jobs[0] : row.generation_jobs;
  const src = Array.isArray(gj.sources) ? gj.sources[0] : gj.sources;
  const proj = Array.isArray(src.projects) ? src.projects[0] : src.projects;
  return proj?.user_id ?? null;
}
