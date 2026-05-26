import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { CommunityPublish } from "@/components/community-publish";
import { DeckDetail, type DeckCard } from "@/components/deck-detail";
import { syncFollowSubscriptionIfNeeded } from "@/lib/community/subscribe";
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    await syncFollowSubscriptionIfNeeded(supabase, id, user.id);
  }

  let publication: DeckPublication | null = null;
  if (user && project.user_id === user.id) {
    const { data } = await supabase
      .from("deck_publications")
      .select("*")
      .eq("source_project_id", id)
      .maybeSingle();
    publication = (data as DeckPublication | null) ?? null;
  }

  const { data: jobs } = await supabase
    .from("generation_jobs")
    .select("id, status, error, progress, sources!inner(project_id)")
    .eq("sources.project_id", id)
    .order("created_at", { ascending: false });

  const latestJob = jobs?.[0];

  const { data: cards } = await supabase
    .from("cards")
    .select("*, generation_jobs!inner(source_id, sources!inner(project_id))")
    .eq("generation_jobs.sources.project_id", id)
    .order("sort_order", { ascending: true });

  const typedCards: DeckCard[] = (cards ?? []).map((c) => ({
    id: c.id,
    job_id: c.job_id,
    type: c.type,
    front: c.front,
    back: c.back,
    cloze_text: c.cloze_text,
    extra: c.extra,
    tags: c.tags ?? [],
    sort_order: c.sort_order,
    user_edited: c.user_edited,
  }));

  const counts =
    typedCards.length > 0 ? await getDeckCounts(supabase, id, project.user_id) : null;
  const settings = settingsFromRecord(project.settings);

  return (
    <>
      <PageHeader
        title={project.deck_name || project.name}
        back={{ href: "/decks", label: "Browse" }}
        action={
          <>
            {typedCards.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {counts && (counts.due > 0 || counts.new_today_remaining > 0) && (
                  <span
                    style={{
                      font: "500 13px/20px var(--font-sans)",
                      color: "var(--fg-3)",
                    }}
                  >
                    <strong style={{ color: "var(--ink-900)" }}>{counts.due}</strong> due
                    {" · "}
                    <strong style={{ color: "var(--ink-900)" }}>{counts.new_today_remaining}</strong> new
                  </span>
                )}
                <Link href={`/decks/${id}/study`} className="btn btn-primary">
                  <i className="ri-book-open-line" />
                  Study Now
                </Link>
              </div>
            )}
          </>
        }
      />
      <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
        {user && project.user_id === user.id && typedCards.length > 0 && (
          <CommunityPublish
            projectId={id}
            deckName={project.deck_name || project.name}
            cardCount={typedCards.length}
            initialPublication={publication}
          />
        )}
        <DeckDetail
          projectId={id}
          jobId={latestJob?.id ?? null}
          jobStatus={latestJob?.status ?? null}
          jobError={latestJob?.error ?? null}
          jobProgress={latestJob?.progress ?? 0}
          deckName={project.deck_name || project.name}
          cards={typedCards}
          initialSettings={settings}
        />
      </div>
    </>
  );
}
