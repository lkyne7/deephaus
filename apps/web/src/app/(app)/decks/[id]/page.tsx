import { notFound } from "next/navigation";
import { DeckPageView } from "@/components/deck-page/deck-page-view";
import { DeckReviewPrefetcher } from "@/components/deck-review-prefetcher";
import { DeckSubscriptionSync } from "@/components/deck-subscription-sync";
import { getAuthUser } from "@/lib/data/server-auth";
import { createClient } from "@/lib/supabase/server";
import { getDeckCounts } from "@/lib/fsrs/stats";
import { resolveEffectiveDeckSettings, settingsFromRecord } from "@/lib/fsrs/settings";
import { loadUserWeights } from "@/lib/fsrs/scheduler";
import { loadGlobalStudySettings } from "@/lib/fsrs/user-study-settings";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_FOCUS_PRESET,
  DEFAULT_NEW_CARDS_PER_DAY,
  parseGenerationSettings,
} from "@deephaus/shared";
import type { DeckPublication } from "@/lib/community/types";

export const dynamic = "force-dynamic";

type DeckPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ panel?: string }>;
};

export default async function DeckPage({ params, searchParams }: DeckPageProps) {
  const { id } = await params;
  const { panel } = await searchParams;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, user_id, name, deck_name, settings, updated_at")
    .eq("id", id)
    .single();

  if (!project) notFound();

  const user = await getAuthUser();

  const isOwner = Boolean(user && project.user_id === user.id);

  const [{ data: publication }, { data: jobs }, { data: cardCountRows }] = await Promise.all([
    isOwner
      ? supabase
          .from("deck_publications")
          .select("*")
          .eq("source_project_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("generation_jobs")
      .select("id, status, error, progress, sources!inner(project_id)")
      .eq("sources.project_id", id)
      .order("created_at", { ascending: false }),
    supabase.rpc("count_cards_by_projects", { p_project_ids: [id] }),
  ]);

  const cardCount = Number(
    ((cardCountRows ?? []) as Array<{ project_id: string; card_count: number }>)[0]?.card_count ?? 0,
  );

  const deckCounts =
    user && cardCount > 0
      ? await getDeckCounts(supabase, id, user.id, project.settings).catch(() => null)
      : null;
  const settings = settingsFromRecord(project.settings);
  const latestJob = jobs?.[0];

  const [globalSettings, userWeights] = user
    ? await Promise.all([
        loadGlobalStudySettings(supabase, user.id),
        loadUserWeights(supabase, user.id),
      ])
    : [null, undefined];

  const effectiveSettings = globalSettings
    ? resolveEffectiveDeckSettings(settings, globalSettings)
    : settings;

  const hasOptimizedParams = Boolean(userWeights?.fsrs7);
  const generation = parseGenerationSettings(project.settings ?? {});

  return (
    <>
      {user ? <DeckSubscriptionSync deckId={id} /> : null}
      <DeckReviewPrefetcher deckId={id} enabled={cardCount > 0} />
      <DeckPageView
        projectId={id}
        title={project.deck_name || project.name}
        cardCount={cardCount}
        due={deckCounts?.due ?? 0}
        newCount={deckCounts?.new ?? 0}
        isOwner={isOwner}
        publication={(publication as DeckPublication | null) ?? null}
        jobId={latestJob?.id ?? null}
        jobStatus={latestJob?.status ?? null}
        jobError={latestJob?.error ?? null}
        jobProgress={latestJob?.progress ?? 0}
        // The deck's own options over the study defaults, as the queue uses them.
        initialSettings={{ ...settings, reviewOrder: effectiveSettings.reviewOrder }}
        globalSettings={
          globalSettings ?? {
            desiredRetention: DEFAULT_DESIRED_RETENTION,
            newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY,
          }
        }
        effectiveSettings={effectiveSettings}
        hasOptimizedParams={hasOptimizedParams}
        composerDefaults={{
          detail: generation.detailLevel,
          focus: generation.focusPreset ?? DEFAULT_FOCUS_PRESET,
        }}
        initialPanel={panel === "settings" || panel === "sharing" ? panel : null}
      />
    </>
  );
}
