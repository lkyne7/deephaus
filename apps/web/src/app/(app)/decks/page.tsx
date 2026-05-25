import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DeckBrowser } from "@/components/deck-browser";
import { type DeckRow } from "@/components/deck-table";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function formatDate(s: string | null) {
  if (!s) return null;
  return new Date(s).toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
}

async function loadDecks(): Promise<DeckRow[]> {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, deck_name, updated_at")
    .order("updated_at", { ascending: false });

  if (!projects) return [];

  const projectIds = projects.map((p) => p.id);
  if (projectIds.length === 0) return [];

  const { data: cards } = await supabase
    .from("cards")
    .select("id, job_id, generation_jobs!inner(source_id, sources!inner(project_id))")
    .in("generation_jobs.sources.project_id", projectIds);

  const cardCountByProject = new Map<string, number>();
  for (const c of cards ?? []) {
    type Row = { generation_jobs: { sources: { project_id: string } } };
    const pid = (c as unknown as Row).generation_jobs.sources.project_id;
    cardCountByProject.set(pid, (cardCountByProject.get(pid) ?? 0) + 1);
  }

  return projects.map((p) => ({
    id: p.id,
    title: p.deck_name || p.name,
    newCount: cardCountByProject.get(p.id) ?? 0,
    dueCount: 0,
    lastReviewed: formatDate(p.updated_at),
  }));
}

export default async function BrowsePage() {
  const decks = await loadDecks();

  return (
    <>
      <PageHeader
        title="Browse"
        action={
          <Link href="/decks/new" className="btn btn-primary">
            <i className="ri-add-line" />
            Create Deck
          </Link>
        }
      />
      <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
        <DeckBrowser decks={decks} />
      </div>
    </>
  );
}
