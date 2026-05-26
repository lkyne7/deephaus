import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { cardToRowFields, emptyCard } from "@/lib/fsrs/scheduler";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  action: z.enum(["suspend", "unsuspend", "delete"]),
  card_ids: z.array(z.string().uuid()).min(1).max(500),
});

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
      ...cardToRowFields(emptyCard(now)),
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
