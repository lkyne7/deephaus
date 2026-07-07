import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireAuth } from "@/lib/auth";
import { loadUserParams, resolveDeckParams } from "@/lib/fsrs/scheduler";
import { loadDeckSettings } from "@/lib/fsrs/settings";
import { simulateReviews, type SimulatorCardState } from "@/lib/fsrs/simulator";
import { countNewStudyCards, fetchDeckReviewsForProject } from "@/lib/study/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_DAYS = 7;
const MAX_DAYS = 365;

/**
 * Project the deck's review workload with the FSRS simulator.
 *
 *   GET /api/decks/{deckId}/simulate?days=90&newPerDay=20&retention=0.9&maxPerDay=200
 *
 * All parameters are optional; newPerDay and retention default to the deck's
 * study settings, days to 90. Uses the same FSRS weights the real scheduler
 * would (deck preset > user-optimized > defaults).
 */
export const GET = withApiTiming(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  const { id: deckId } = await params;

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id")
    .eq("id", deckId)
    .eq("user_id", user!.id)
    .maybeSingle();
  if (!project) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const days = clampInt(url.searchParams.get("days"), 90, MIN_DAYS, MAX_DAYS);

  const [settings, userParams, reviewRows, newCardsRemaining] = await Promise.all([
    loadDeckSettings(supabase, deckId, user!.id),
    loadUserParams(supabase, user!.id),
    fetchDeckReviewsForProject(supabase, deckId, user!.id),
    countNewStudyCards(supabase, deckId, user!.id),
  ]);

  const newPerDay = clampInt(url.searchParams.get("newPerDay"), settings.newCardsPerDay, 0, 500);
  const retention = clampFloat(
    url.searchParams.get("retention"),
    settings.desiredRetention,
    0.7,
    0.99,
  );
  const maxPerDay = clampInt(url.searchParams.get("maxPerDay"), 0, 0, 5000);

  const cards: SimulatorCardState[] = reviewRows
    .filter((row) => !row.suspended && row.state !== 0)
    .map((row) => ({
      stability: row.stability,
      difficulty: row.difficulty,
      state: row.state,
      due: row.due,
      lastReview: row.last_review,
      scheduledDays: row.scheduled_days,
      reps: row.reps,
      lapses: row.lapses,
      learningSteps: row.learning_steps ?? 0,
    }));

  const result = simulateReviews({
    days,
    newPerDay,
    newCardsRemaining,
    desiredRetention: retention,
    w: resolveDeckParams(settings.fsrsParams, userParams),
    maxReviewsPerDay: maxPerDay > 0 ? maxPerDay : undefined,
    cards,
  });

  return NextResponse.json({
    deck_id: deckId,
    inputs: {
      days,
      new_per_day: newPerDay,
      desired_retention: retention,
      max_per_day: maxPerDay > 0 ? maxPerDay : null,
      scheduled_cards: cards.length,
      new_cards_remaining: newCardsRemaining,
    },
    ...result,
  });
}, "GET /api/decks/[id]/simulate");

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null || value === "") return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampFloat(value: string | null, fallback: number, min: number, max: number) {
  if (value == null || value === "") return fallback;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
