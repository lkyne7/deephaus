import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

const ratingSchema = z.object({
  stars: z.number().int().min(1).max(5),
});

export const PUT = withApiTiming(async function PUT(request: Request, context: RouteContext) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = ratingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "stars must be an integer from 1 to 5" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: publication, error: pubError } = await supabase
    .from("deck_publications")
    .select("id, publisher_id, avg_rating, rating_count")
    .eq("id", id)
    .maybeSingle();

  if (pubError) {
    return NextResponse.json({ error: pubError.message }, { status: 500 });
  }
  if (!publication) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }
  if (publication.publisher_id === user!.id) {
    return NextResponse.json({ error: "You cannot rate your own deck" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error: upsertError } = await supabase.from("publication_ratings").upsert(
    {
      publication_id: id,
      user_id: user!.id,
      stars: parsed.data.stars,
      updated_at: now,
    },
    { onConflict: "publication_id,user_id" },
  );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const { data: updated } = await supabase
    .from("deck_publications")
    .select("avg_rating, rating_count")
    .eq("id", id)
    .single();

  return NextResponse.json({
    my_rating: parsed.data.stars,
    avg_rating: Number(updated?.avg_rating ?? 0),
    rating_count: Number(updated?.rating_count ?? 0),
  });
}, "PUT /api/community/decks/[id]/rating");

export const DELETE = withApiTiming(async function DELETE(_request: Request, context: RouteContext) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await context.params;
  const supabase = await createClient();

  const { error } = await supabase
    .from("publication_ratings")
    .delete()
    .eq("publication_id", id)
    .eq("user_id", user!.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: updated } = await supabase
    .from("deck_publications")
    .select("avg_rating, rating_count")
    .eq("id", id)
    .maybeSingle();

  return NextResponse.json({
    my_rating: null,
    avg_rating: Number(updated?.avg_rating ?? 0),
    rating_count: Number(updated?.rating_count ?? 0),
  });
}, "DELETE /api/community/decks/[id]/rating");
