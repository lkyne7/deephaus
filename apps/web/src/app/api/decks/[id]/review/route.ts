import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireAuth } from "@/lib/auth";
import {
  buildScheduler,
  emptyCard,
  loadUserParams,
  previewIntervals,
  resolveDeckParams,
  rowToCard,
} from "@/lib/fsrs/scheduler";
import { resolveEffectiveDeckSettings, settingsFromRecord } from "@/lib/fsrs/settings";
import { loadGlobalStudySettings } from "@/lib/fsrs/user-study-settings";
import { startOfStudyDayIso } from "@/lib/study/day-start";
import {
  buildStudySessionQueue,
  countNewReviewsTodayForDeck,
  reviewFieldsFromItem,
  type StudyQueueItem,
} from "@/lib/study/queue";

/**
 * Build a study session for the current user against a deck.
 *
 *   GET /api/decks/{deckId}/review?limit=20&newLimit=<deck.newCardsPerDay>
 */
export const GET = withApiTiming(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, supabase, response } = await requireAuth();
  if (response) return response;

  const { id: deckId } = await params;
  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);

  const now = new Date();
  const nowIso = now.toISOString();

  const [{ data: project, error: projectError }, userParams, global] = await Promise.all([
    supabase
      .from("projects")
      .select("id, deck_name, name, settings")
      .eq("id", deckId)
      .eq("user_id", user!.id)
      .single(),
    loadUserParams(supabase, user!.id),
    loadGlobalStudySettings(supabase, user!.id),
  ]);

  if (projectError || !project) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  // Study day rolls over at the user's configured hour (Anki-style), not midnight.
  const startOfDayIso = startOfStudyDayIso(now, global.dayStartHour, global.timezone);
  const newToday = await countNewReviewsTodayForDeck(supabase, deckId, user!.id, startOfDayIso);

  const settings = resolveEffectiveDeckSettings(settingsFromRecord(project.settings), global);
  const requestedNewLimit = clampInt(
    url.searchParams.get("newLimit"),
    settings.newCardsPerDay,
    0,
    200,
  );
  const newSupply = Math.max(0, requestedNewLimit - newToday);

  let session;
  try {
    session = await buildStudySessionQueue(supabase, deckId, user!.id, nowIso, newSupply);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load study queue";
    console.error("[review queue]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const queueItems = [...session.due, ...session.newItems].slice(0, limit);

  const scheduler = buildScheduler({
    w: resolveDeckParams(settings.fsrsParams, userParams),
    requestRetention: settings.desiredRetention,
  });

  const payload = queueItems.map((item) => queueItemToPayload(item, scheduler, now));

  const learningDue = session.due.filter(
    (item) => item.review && (item.review.state === 1 || item.review.state === 3),
  ).length;

  return NextResponse.json({
    deck: { id: project.id, name: project.deck_name || project.name, settings },
    cards: payload,
    day_start_hour: global.dayStartHour,
    learn_ahead: session.usedLearnAhead,
    counts: {
      due: session.due.length,
      new: session.newTotal,
      learning: learningDue,
      total: payload.length,
      // Today's new-card budget capped by what the deck can actually supply.
      new_today_remaining: Math.min(Math.max(0, newSupply), session.newTotal),
    },
  });
}, "GET /api/decks/[id]/review");

function queueItemToPayload(
  item: StudyQueueItem,
  scheduler: ReturnType<typeof buildScheduler>,
  now: Date,
) {
  const row = reviewFieldsFromItem(item);
  const fsrsCard = item.review ? rowToCard(row) : emptyCard(now);
  return {
    id: item.card.id,
    queue_key: item.queue_key,
    cloze_ord: item.cloze_ord,
    type: item.card.type as "basic" | "cloze",
    front: item.card.front,
    back: item.card.back,
    cloze_text: item.card.cloze_text,
    extra: item.card.extra,
    occlusion_data: item.card.occlusion_data ?? null,
    tags: item.card.tags ?? [],
    state: fsrsCard.state as number,
    due: fsrsCard.due.toISOString(),
    reps: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    intervals: previewIntervals(scheduler, fsrsCard, now),
    is_new: !item.review || item.review.state === 0,
  };
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
