import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPublisherNames } from "@/lib/community/authors";
import { loadPublicationFacts, loadPublicationPreview } from "@/lib/community/subscribe";

type RouteContext = { params: Promise<{ id: string }> };

/**
 *   GET /api/community/decks/{id}?offset=&limit=
 *
 * A published deck with a page of its cards. `offset` and `limit` page through
 * the samples ("Show more", "Try cards"). The first page also says what the
 * deck holds: cards per type and its most used tags.
 */
export const GET = withApiTiming(async function GET(request: Request, context: RouteContext) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await context.params;
  const supabase = await createClient();
  const url = new URL(request.url);
  const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
  const limit = Number(url.searchParams.get("limit") ?? 0) || undefined;

  try {
    const preview = await loadPublicationPreview(supabase, id, { offset, limit });
    const [{ data: subscription }, { data: rating }, facts, authors] = await Promise.all([
      supabase
        .from("deck_subscriptions")
        .select("sync_mode, local_project_id")
        .eq("publication_id", id)
        .eq("subscriber_id", user!.id)
        .maybeSingle(),
      supabase
        .from("publication_ratings")
        .select("stars")
        .eq("publication_id", id)
        .eq("user_id", user!.id)
        .maybeSingle(),
      offset === 0 ? loadPublicationFacts(supabase, id) : Promise.resolve(null),
      loadPublisherNames([preview.publication.publisher_id as string]),
    ]);

    const isSubscribed = Boolean(subscription);
    const isOwner = preview.publication.publisher_id === user!.id;
    const myRating = rating ? Number(rating.stars) : null;

    return NextResponse.json({
      ...preview,
      publication: {
        ...preview.publication,
        avg_rating: Number(preview.publication.avg_rating ?? 0),
        rating_count: Number(preview.publication.rating_count ?? 0),
        is_subscribed: isSubscribed,
        subscription_sync_mode: subscription?.sync_mode ?? null,
        local_project_id: subscription?.local_project_id ?? null,
        is_owner: isOwner,
        my_rating: myRating,
        author: authors.get(preview.publication.publisher_id as string) ?? null,
      },
      facts,
      is_subscribed: isSubscribed,
      subscription_sync_mode: subscription?.sync_mode ?? null,
      local_project_id: subscription?.local_project_id ?? null,
      my_rating: myRating,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}, "GET /api/community/decks/[id]");
