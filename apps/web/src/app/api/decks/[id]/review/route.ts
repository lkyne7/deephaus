import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  type CardReviewRow,
  emptyCard,
  previewIntervals,
  rowToCard,
} from "@/lib/fsrs/scheduler";

/**
 * Build a study session for the current user against a deck.
 *
 *   GET /api/decks/{deckId}/review?limit=20&newLimit=10
 *
 * Returns the cards that should be reviewed right now, ordered as:
 *   1. Learning / relearning cards whose due time has passed
 *   2. Review cards whose due time has passed (oldest due first)
 *   3. New cards the user hasn't seen yet (up to `newLimit`)
 *
 * Each card carries its FSRS state (or a fresh empty card for "new" cards)
 * plus the predicted next-interval label for each rating so the UI can show
 * accurate "Again / Hard / Good / Easy" buttons.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id: deckId } = await params;
  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get("limit"), 20, 1, 200);
  const newLimit = clampInt(url.searchParams.get("newLimit"), 10, 0, 100);

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, deck_name, name")
    .eq("id", deckId)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const { data: cards, error: cardsError } = await supabase
    .from("cards")
    .select(
      "id, type, front, back, cloze_text, extra, sort_order, generation_jobs!inner(source_id, sources!inner(project_id))",
    )
    .eq("generation_jobs.sources.project_id", deckId)
    .order("sort_order", { ascending: true });

  if (cardsError) {
    return NextResponse.json({ error: cardsError.message }, { status: 500 });
  }
  if (!cards || cards.length === 0) {
    return NextResponse.json({
      deck: { id: project.id, name: project.deck_name || project.name },
      cards: [],
      counts: { due: 0, new: 0, learning: 0, total: 0 },
    });
  }

  const cardIds = cards.map((c) => c.id);

  const { data: reviews } = await supabase
    .from("card_reviews")
    .select(
      "card_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps",
    )
    .eq("user_id", user!.id)
    .in("card_id", cardIds);

  const reviewByCardId = new Map<string, CardReviewRow & { card_id: string }>();
  for (const r of (reviews ?? []) as Array<CardReviewRow & { card_id: string }>) {
    reviewByCardId.set(r.card_id, r);
  }

  const now = new Date();
  const dueCards: typeof cards = [];
  const newCards: typeof cards = [];

  for (const card of cards) {
    const review = reviewByCardId.get(card.id);
    if (!review) {
      newCards.push(card);
      continue;
    }
    // state: 0=New, 1=Learning, 2=Review, 3=Relearning. New (0) shouldn't
    // happen if a review row exists, but treat it as new just in case.
    if (review.state === 0) {
      newCards.push(card);
      continue;
    }
    if (new Date(review.due).getTime() <= now.getTime()) {
      dueCards.push(card);
    }
  }

  dueCards.sort((a, b) => {
    const ra = reviewByCardId.get(a.id);
    const rb = reviewByCardId.get(b.id);
    if (!ra || !rb) return 0;
    // Learning / relearning first, then review; within each, oldest due first.
    const pa = ra.state === 1 || ra.state === 3 ? 0 : 1;
    const pb = rb.state === 1 || rb.state === 3 ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(ra.due).getTime() - new Date(rb.due).getTime();
  });

  const queue = [...dueCards, ...newCards.slice(0, newLimit)].slice(0, limit);

  const payload = queue.map((card) => {
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
      intervals: previewIntervals(fsrsCard, now),
      is_new: !row,
    };
  });

  return NextResponse.json({
    deck: { id: project.id, name: project.deck_name || project.name },
    cards: payload,
    counts: {
      due: dueCards.length,
      new: newCards.length,
      learning: dueCards.filter((c) => {
        const r = reviewByCardId.get(c.id);
        return r?.state === 1 || r?.state === 3;
      }).length,
      total: queue.length,
    },
  });
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
