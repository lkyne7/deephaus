import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { cardToRowFields, emptyCard } from "@/lib/fsrs/scheduler";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  suspended: z.boolean(),
});

export const PATCH = withApiTiming(async function PATCH(
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

  const supabase = await createClient();

  const { data: cardRow } = await supabase
    .from("cards")
    .select("id, generation_jobs!inner(sources!inner(projects!inner(user_id)))")
    .eq("id", cardId)
    .eq("generation_jobs.sources.projects.user_id", user!.id)
    .maybeSingle();

  if (!cardRow) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const now = new Date();

  const { data: existingRows, error: fetchError } = await supabase
    .from("card_reviews")
    .select("due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps")
    .eq("card_id", cardId)
    .eq("user_id", user!.id);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if ((existingRows ?? []).length > 0) {
    const { error } = await supabase
      .from("card_reviews")
      .update({ suspended: body.suspended, updated_at: now.toISOString() })
      .eq("card_id", cardId)
      .eq("user_id", user!.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ suspended: body.suspended });
  }

  const fields = cardToRowFields(emptyCard(now));
  const { data, error } = await supabase
    .from("card_reviews")
    .upsert(
      {
        card_id: cardId,
        user_id: user!.id,
        cloze_ord: 0,
        ...fields,
        suspended: body.suspended,
        updated_at: now.toISOString(),
      },
      { onConflict: "card_id,user_id,cloze_ord" },
    )
    .select("suspended")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ suspended: data.suspended });
}, "PATCH /api/cards/[id]/suspend");
