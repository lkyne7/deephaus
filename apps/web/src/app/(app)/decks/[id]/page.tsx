import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { DeckDetail, type DeckCard } from "@/components/deck-detail";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type DeckPageProps = { params: Promise<{ id: string }> };

export default async function DeckPage({ params }: DeckPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, deck_name, settings, updated_at")
    .eq("id", id)
    .single();

  if (!project) notFound();

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

  return (
    <>
      <PageHeader
        title={project.deck_name || project.name}
        back={{ href: "/decks", label: "Browse" }}
        action={
          <>
            {typedCards.length > 0 && (
              <Link href={`/decks/${id}/study`} className="btn btn-primary">
                <i className="ri-book-open-line" />
                Study Now
              </Link>
            )}
          </>
        }
      />
      <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
        <DeckDetail
          projectId={id}
          jobId={latestJob?.id ?? null}
          jobStatus={latestJob?.status ?? null}
          jobError={latestJob?.error ?? null}
          jobProgress={latestJob?.progress ?? 0}
          deckName={project.deck_name || project.name}
          cards={typedCards}
        />
      </div>
    </>
  );
}
