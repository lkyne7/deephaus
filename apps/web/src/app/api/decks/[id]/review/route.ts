import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buildScheduler,
  emptyCard,
  loadUserParams,
  previewIntervals,
  resolveDeckParams,
  rowToCard,
} from "@/lib/fsrs/scheduler";
import { settingsFromRecord } from "@/lib/fsrs/settings";
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
  const { user, response } = await requireUser();
  if (response) return response;

  const { id: deckId } = await params;
  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get("limit"), 50, 1, 200);

  const supabase = await createClient();

  const now = new Date();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const nowIso = now.toISOString();

  const [{ data: project, error: projectError }, newToday, userParams] = await Promise.all([
    supabase
      .from("projects")
      .select("id, deck_name, name, settings")
      .eq("id", deckId)
      .eq("user_id", user!.id)
      .single(),
    countNewReviewsTodayForDeck(supabase, deckId, user!.id, startOfDay.toISOString()),
    loadUserParams(supabase, user!.id),
  ]);

  if (projectError || !project) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const settings = settingsFromRecord(project.settings);
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
    counts: {
      due: session.due.length,
      new: session.newTotal,
      learning: learningDue,
      total: payload.length,
      new_today_remaining: Math.max(0, newSupply),
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
