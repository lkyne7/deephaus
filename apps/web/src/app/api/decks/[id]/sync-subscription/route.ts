import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { syncFollowSubscriptionIfNeeded } from "@/lib/community/subscribe";
import { createClient } from "@/lib/supabase/server";

/** Background sync for followed community decks (non-blocking on deck page load). */
export const POST = withApiTiming(async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id: deckId } = await params;
  const supabase = await createClient();

  const synced = await syncFollowSubscriptionIfNeeded(supabase, deckId, user!.id);
  return NextResponse.json({ synced });
}, "POST /api/decks/[id]/sync-subscription");
