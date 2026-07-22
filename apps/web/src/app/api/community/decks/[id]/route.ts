import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPublicationPreview } from "@/lib/community/subscribe";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApiTiming(async function GET(_request: Request, context: RouteContext) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await context.params;
  const supabase = await createClient();

  try {
    const preview = await loadPublicationPreview(supabase, id);

    const [{ data: subscription }, { data: rating }] = await Promise.all([
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
    ]);

    return NextResponse.json({
      ...preview,
      publication: {
        ...preview.publication,
        avg_rating: Number(preview.publication.avg_rating ?? 0),
        rating_count: Number(preview.publication.rating_count ?? 0),
      },
      is_subscribed: Boolean(subscription),
      subscription_sync_mode: subscription?.sync_mode ?? null,
      local_project_id: subscription?.local_project_id ?? null,
      my_rating: rating ? Number(rating.stars) : null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Not found";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}, "GET /api/community/decks/[id]");
