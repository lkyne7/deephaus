import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { loadTopicSuggestions } from "@/lib/topics/load-topic-suggestions";

/**
 * Personalized topic chips for the Topic generator (3–5 items).
 *
 * GET /api/generate/topic/suggestions
 */
export const GET = withApiTiming(async function GET() {
  const { user, supabase, response } = await requireUser();
  if (response) return response;

  try {
    const suggestions = await loadTopicSuggestions(supabase, user!.id);
    return NextResponse.json({ suggestions });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load topic suggestions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "GET /api/generate/topic/suggestions");
