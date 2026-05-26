import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { getDeckCounts } from "@/lib/fsrs/stats";
import { settingsFromRecord } from "@/lib/fsrs/settings";
import { createClient } from "@/lib/supabase/server";
import type { DeckPublication } from "@/lib/community/types";

export const GET = withApiTiming(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id: deckId } = await params;
  const supabase = await createClient();

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, name, deck_name, settings, user_id")
    .eq("id", deckId)
    .eq("user_id", user!.id)
    .single();

  if (projectError || !project) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const [{ data: cards }, { data: typeRows }, { data: publication }] = await Promise.all([
    supabase
      .from("cards")
      .select("id, type, front, back, cloze_text, extra, sort_order, generation_jobs!inner(sources!inner(project_id))")
      .eq("generation_jobs.sources.project_id", deckId)
      .order("sort_order", { ascending: true })
      .limit(8),
    supabase
      .from("cards")
      .select("type, generation_jobs!inner(sources!inner(project_id))")
      .eq("generation_jobs.sources.project_id", deckId),
    supabase
      .from("deck_publications")
      .select("*")
      .eq("source_project_id", deckId)
      .eq("publisher_id", user!.id)
      .maybeSingle(),
  ]);

  const typedCards = cards ?? [];
  const allTypes = (typeRows ?? []) as Array<{ type: string }>;
  const counts = await getDeckCounts(supabase, deckId, user!.id);

  const settings = settingsFromRecord(project.settings);
  const basicCount = allTypes.filter((c) => c.type === "basic").length;
  const clozeCount = allTypes.filter((c) => c.type === "cloze").length;

  return NextResponse.json({
    id: project.id,
    title: project.deck_name || project.name,
    card_count: counts.total,
    basic_count: basicCount,
    cloze_count: clozeCount,
    counts: {
      due: counts.due,
      new: counts.new,
      new_today_remaining: counts.new_today_remaining,
    },
    settings: {
      desiredRetention: settings.desiredRetention,
      newCardsPerDay: settings.newCardsPerDay,
    },
    publication: (publication as DeckPublication | null) ?? null,
    preview_cards: typedCards.slice(0, 5).map((c) => ({
      id: c.id,
      type: c.type as "basic" | "cloze",
      front: c.front,
      back: c.back,
      cloze_text: c.cloze_text,
      extra: c.extra,
    })),
  });
}, "GET /api/decks/[id]/overview");
