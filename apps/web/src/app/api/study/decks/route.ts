import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getUserProjects } from "@/lib/data/server-auth";
import { getStudyDeckOptions } from "@/lib/study/decks";

/** Deck list with accurate due/new counts for the study hub and in-session deck switcher. */
export const GET = withApiTiming(async function GET() {
  const { user, response } = await requireUser();
  if (response) return response;

  const supabase = await createClient();

  try {
    const projects = await getUserProjects(user!.id);
    const decks = await getStudyDeckOptions(supabase, user!.id, projects);
    return NextResponse.json({ decks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load study decks";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "GET /api/study/decks");
