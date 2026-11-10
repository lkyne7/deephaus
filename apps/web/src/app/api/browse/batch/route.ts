import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { invalidateUserStudyCaches } from "@/lib/cache/invalidate";
import { CardBatchError, moveCards, tagCards } from "@/lib/cards/batch";
import { newReviewFields } from "@/lib/fsrs/scheduler";
import { createClient } from "@/lib/supabase/server";

const cardIds = z.array(z.string().uuid()).min(1).max(500);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["suspend", "unsuspend", "delete"]), card_ids: cardIds }),
  /** Move the cards into another of the user's decks. */
  z.object({ action: z.literal("move"), card_ids: cardIds, deck_id: z.string().uuid() }),
  /** Add one tag to the cards, or take it off them. */
  z.object({ action: z.enum(["tag", "untag"]), card_ids: cardIds, tag: z.string().min(1).max(200) }),
]);

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const supabase = await createClient();
  const uniqueIds = [...new Set(body.card_ids)];

  const { data: owned } = await supabase
    .from("cards")
    .select("id, generation_jobs!inner(sources!inner(projects!inner(user_id)))")
    .in("id", uniqueIds)
    .eq("generation_jobs.sources.projects.user_id", user!.id);

  const ownedIds = new Set((owned ?? []).map((c) => c.id as string));
  const allowedIds = uniqueIds.filter((id) => ownedIds.has(id));
  if (allowedIds.length === 0) {
    return NextResponse.json({ error: "No matching cards" }, { status: 404 });
  }

  if (body.action === "delete") {
    const { error } = await supabase.from("cards").delete().in("id", allowedIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ updated: allowedIds.length });
  }

  if (body.action === "move" || body.action === "tag" || body.action === "untag") {
    try {
      if (body.action === "move") {
        const moved = await moveCards(supabase, user!.id, allowedIds, body.deck_id);
        // Deck counts changed on both sides.
        if (moved.moved > 0) invalidateUserStudyCaches(user!.id);
        return NextResponse.json({ updated: moved.moved, ...moved });
      }
      return NextResponse.json(await tagCards(supabase, allowedIds, body.tag, body.action));
    } catch (e) {
      if (e instanceof CardBatchError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
  }

  const suspended = body.action === "suspend";
  const now = new Date();

  const { data: existingReviews } = await supabase
    .from("card_reviews")
    .select(
      "card_id, cloze_ord, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps",
    )
    .eq("user_id", user!.id)
    .in("card_id", allowedIds);

  const cardsWithReviews = new Set((existingReviews ?? []).map((r) => r.card_id as string));
  const cardsWithoutReviews = allowedIds.filter((id) => !cardsWithReviews.has(id));

  if ((existingReviews ?? []).length > 0) {
    const { error: updateError } = await supabase
      .from("card_reviews")
      .update({ suspended, updated_at: now.toISOString() })
      .eq("user_id", user!.id)
      .in("card_id", allowedIds);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (cardsWithoutReviews.length > 0) {
    const rows = cardsWithoutReviews.map((cardId) => ({
      card_id: cardId,
      user_id: user!.id,
      cloze_ord: 0,
      ...newReviewFields(now),
      suspended,
      updated_at: now.toISOString(),
    }));

    const { error: insertError } = await supabase
      .from("card_reviews")
      .upsert(rows, { onConflict: "card_id,user_id,cloze_ord" });

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ updated: allowedIds.length, suspended });
}, "POST /api/browse/batch");
