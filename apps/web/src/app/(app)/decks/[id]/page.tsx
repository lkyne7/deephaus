import { notFound } from "next/navigation";
import { CommunityPublish } from "@/components/community-publish";
import { DeckPageHeader } from "@/components/deck-page-header";
import { DeckReviewPrefetcher } from "@/components/deck-review-prefetcher";
import { DeckSubscriptionSync } from "@/components/deck-subscription-sync";
import { DeckDetail } from "@/components/deck-detail";
import { getAuthUser } from "@/lib/data/server-auth";
import { createClient } from "@/lib/supabase/server";
import { getDeckCounts } from "@/lib/fsrs/stats";
import { settingsFromRecord } from "@/lib/fsrs/settings";
import type { DeckPublication } from "@/lib/community/types";

export const dynamic = "force-dynamic";

type DeckPageProps = { params: Promise<{ id: string }> };

export default async function DeckPage({ params }: DeckPageProps) {
  const { id } = await params;
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

  return (
    <>
      {user ? <DeckSubscriptionSync deckId={id} /> : null}
      <DeckReviewPrefetcher deckId={id} enabled={cardCount > 0} />
      <DeckPageHeader
        title={project.deck_name || project.name}
        deckId={id}
        due={deckCounts?.due ?? 0}
        newRemaining={deckCounts?.new_today_remaining ?? 0}
        showStudy={cardCount > 0}
      />
      <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
        {isOwner && cardCount > 0 && (
          <CommunityPublish
            projectId={id}
            deckName={project.deck_name || project.name}
            cardCount={cardCount}
            initialPublication={(publication as DeckPublication | null) ?? null}
          />
        )}
        <DeckDetail
          projectId={id}
          jobId={latestJob?.id ?? null}
          jobStatus={latestJob?.status ?? null}
          jobError={latestJob?.error ?? null}
          jobProgress={latestJob?.progress ?? 0}
          deckName={project.deck_name || project.name}
          cardCount={cardCount}
          initialSettings={settings}
        />
      </div>
    </>
  );
}
