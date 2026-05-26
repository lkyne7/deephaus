import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buildScheduler,
  emptyCard,
  loadUserParams,
  previewIntervals,
  rowToCard,
} from "@/lib/fsrs/scheduler";
import { settingsFromRecord } from "@/lib/fsrs/settings";
import {
  countNewReviewsTodayForDeck,
  countNewStudyCards,
  dueRowToCard,
  fetchDueStudyRows,
  fetchNewStudyCards,
  reviewFieldsFromDueRow,
  sortDueRows,
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

  const { data: project } = await supabase
    .from("projects")
    .select("id, deck_name, name, settings")
    .eq("id", deckId)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const settings = settingsFromRecord(project.settings);
  const requestedNewLimit = clampInt(
    url.searchParams.get("newLimit"),
    settings.newCardsPerDay,
    0,
    200,
  );

  const { count: totalCards, error: countError } = await supabase
    .from("cards")
    .select("id, generation_jobs!inner(sources!inner(project_id))", {
      count: "exact",
      head: true,
    })
    .eq("generation_jobs.sources.project_id", deckId);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if (!totalCards) {
    return NextResponse.json({
      deck: { id: project.id, name: project.deck_name || project.name, settings },
      cards: [],
      counts: { due: 0, new: 0, learning: 0, total: 0, new_today_remaining: requestedNewLimit },
    });
  }

  const now = new Date();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [dueRows, newCardTotal, newToday] = await Promise.all([
    fetchDueStudyRows(supabase, deckId, user!.id, now.toISOString()),
    countNewStudyCards(supabase, deckId, user!.id),
    countNewReviewsTodayForDeck(supabase, deckId, user!.id, startOfDay.toISOString()),
  ]);

  const sortedDue = sortDueRows(dueRows);
  const newSupply = Math.max(0, requestedNewLimit - newToday);
  const newRows =
    newSupply > 0 ? await fetchNewStudyCards(supabase, deckId, user!.id, newSupply) : [];

  const dueCards = sortedDue.map(dueRowToCard);
  const queueCards = [...dueCards, ...newRows].slice(0, limit);

  const reviewByCardId = new Map(
    sortedDue.map((row) => [row.card_id, reviewFieldsFromDueRow(row)]),
  );

  const userParams = await loadUserParams(supabase, user!.id);
  const scheduler = buildScheduler({
    w: userParams,
    requestRetention: settings.desiredRetention,
  });

  const payload = queueCards.map((card) => {
    const row = reviewByCardId.get(card.id);
    const fsrsCard = row ? rowToCard(row) : emptyCard(now);
    return {
      id: card.id,
      type: card.type as "basic" | "cloze",
      front: card.front,
      back: card.back,
      cloze_text: card.cloze_text,
      extra: card.extra,
      state: fsrsCard.state as number,
      due: fsrsCard.due.toISOString(),
      reps: fsrsCard.reps,
      lapses: fsrsCard.lapses,
      intervals: previewIntervals(scheduler, fsrsCard, now),
      is_new: !row,
    };
  });

  const learningDue = sortedDue.filter((r) => r.state === 1 || r.state === 3).length;

  return NextResponse.json({
    deck: { id: project.id, name: project.deck_name || project.name, settings },
    cards: payload,
    counts: {
      due: sortedDue.length,
      new: newCardTotal,
      learning: learningDue,
      total: payload.length,
      new_today_remaining: Math.max(0, newSupply),
    },
  });
}, "GET /api/decks/[id]/review");

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
