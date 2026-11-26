import { NextResponse } from "next/server";
import type { SourceType } from "@deephaus/shared";
import { requireUser } from "@/lib/auth";
import type { DeckPublication, SyncMode } from "@/lib/community/types";
import type { DeckSummary } from "@/lib/decks/deck-summary";
import { loadUserWeights } from "@/lib/fsrs/scheduler";
import { resolveEffectiveDeckSettings, settingsFromRecord } from "@/lib/fsrs/settings";
import { loadGlobalStudySettings } from "@/lib/fsrs/user-study-settings";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { createClient } from "@/lib/supabase/server";

const SAMPLE_CARDS = 3;

const SOURCE_TITLES: Partial<Record<SourceType, string>> = {
  text: "Pasted text",
  youtube: "YouTube transcript",
  notion: "Notion page",
  video: "Video transcript",
  xlsx: "Spreadsheet",
  website: "Website",
};

/**
 *   GET /api/decks/{id}/summary
 *
 * The Decks page's side panel: a few cards, the sources, the study settings
 * (as the pane's settings view edits them), the latest generation run and the
 * deck's Community state. Counts come from the dashboard
 * stats the list already has, so this stays a handful of small queries.
 */
export const GET = withApiTiming(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id: deckId } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, settings")
    .eq("id", deckId)
    .eq("user_id", user!.id)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

  const [
    globalSettings,
    userWeights,
    { data: cards },
    { data: sourceRows },
    { data: publication },
    { data: subscription },
    { data: jobs },
  ] = await Promise.all([
    loadGlobalStudySettings(supabase, user!.id),
    loadUserWeights(supabase, user!.id),
    supabase
      .from("cards")
      .select("id, type, front, back, cloze_text, extra, sort_order, generation_jobs!inner(sources!inner(project_id))")
      .eq("generation_jobs.sources.project_id", deckId)
      .order("sort_order", { ascending: true })
      .limit(SAMPLE_CARDS),
    supabase
      .from("sources")
      .select("id, type, title, created_at")
      .eq("project_id", deckId)
      .not("type", "in", "(topic,apkg)")
      // Hand-written cards hang off an empty text source that has nothing to show.
      .or("type.neq.text,raw_text.neq.")
      .order("created_at", { ascending: false }),
    supabase
      .from("deck_publications")
      .select("*")
      .eq("source_project_id", deckId)
      .eq("publisher_id", user!.id)
      .maybeSingle(),
    supabase
      .from("deck_subscriptions")
      .select("publication_id, sync_mode")
      .eq("local_project_id", deckId)
      .eq("subscriber_id", user!.id)
      .maybeSingle(),
    supabase
      .from("generation_jobs")
      .select("id, status, error, progress, sources!inner(project_id)")
      .eq("sources.project_id", deckId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const deckSettings = settingsFromRecord(project.settings);
  const settings = resolveEffectiveDeckSettings(deckSettings, globalSettings);
  const latestJob = (jobs ?? [])[0] as
    | { id: string; status: string; error: string | null; progress: number | null }
    | undefined;

  const sources = (sourceRows ?? []) as Array<{ id: string; type: SourceType; title: string | null }>;
  const sourceIds = sources.map((row) => row.id);
  const [{ data: sourceJobs }, { data: rating }] = await Promise.all([
    sourceIds.length
      ? supabase.from("generation_jobs").select("source_id, cards(count)").in("source_id", sourceIds)
      : Promise.resolve({ data: [] }),
    subscription
      ? supabase
          .from("publication_ratings")
          .select("stars")
          .eq("publication_id", subscription.publication_id)
          .eq("user_id", user!.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const cardCounts = new Map<string, number>();
  for (const job of (sourceJobs ?? []) as Array<{ source_id: string; cards: Array<{ count: number }> }>) {
    cardCounts.set(job.source_id, (cardCounts.get(job.source_id) ?? 0) + (job.cards[0]?.count ?? 0));
  }

  const summary: DeckSummary = {
    id: deckId,
    settings: {
      desiredRetention: settings.desiredRetention,
      newCardsPerDay: settings.newCardsPerDay,
      hasCustomFsrsParams: Boolean(deckSettings.fsrsParams?.length),
    },
    studySettings: {
      deck: {
        desiredRetention: deckSettings.desiredRetention,
        newCardsPerDay: deckSettings.newCardsPerDay,
        useGlobalFsrsSettings: deckSettings.useGlobalFsrsSettings,
        fsrsParams: deckSettings.fsrsParams,
        // The deck's own options over the study defaults, as the queue uses them.
        reviewOrder: settings.reviewOrder,
      },
      global: {
        desiredRetention: globalSettings.desiredRetention,
        newCardsPerDay: globalSettings.newCardsPerDay,
        reviewOrder: globalSettings.reviewOrder,
      },
      hasOptimizedParams: Boolean(userWeights?.fsrs7),
    },
    job: latestJob
      ? {
          id: latestJob.id,
          status: latestJob.status,
          error: latestJob.error ?? null,
          progress: Number(latestJob.progress ?? 0),
        }
      : null,
    sampleCards: (cards ?? []).map((card) => ({
      id: card.id as string,
      type: card.type as DeckSummary["sampleCards"][number]["type"],
      front: card.front as string | null,
      back: card.back as string | null,
      cloze_text: card.cloze_text as string | null,
      extra: card.extra as string | null,
    })),
    sources: sources.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title?.trim() || SOURCE_TITLES[row.type] || "Document",
      cardCount: cardCounts.get(row.id) ?? 0,
    })),
    publication: (publication as DeckPublication | null) ?? null,
    subscription: subscription
      ? {
          publication_id: subscription.publication_id as string,
          sync_mode: subscription.sync_mode as SyncMode,
          my_rating: rating ? Number((rating as { stars: number }).stars) : null,
        }
      : null,
  };

  return NextResponse.json(summary);
}, "GET /api/decks/[id]/summary");
