import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DeckTable, type DeckRow } from "@/components/deck-table";
import { StatCards } from "@/components/stat-cards";
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
    .select("id, name, deck_name, updated_at, created_at")
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

  return projects.map((p) => {
    const cardCount = cardCountByProject.get(p.id) ?? 0;
    return {
      id: p.id,
      title: p.deck_name || p.name,
      newCount: cardCount,
      dueCount: 0,
      lastReviewed: formatDate(p.updated_at),
    };
  });
}

export default async function DashboardPage() {
  const decks = await loadDecks();
  const totalCards = decks.reduce((acc, d) => acc + d.newCount, 0);
  const dueCards = decks.reduce((acc, d) => acc + d.dueCount, 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        action={
          <Link href="/decks/new" className="btn btn-primary">
            <i className="ri-add-line" />
            Create Deck
          </Link>
        }
      />
      <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 24 }}>
        <StatCards
          totalCards={totalCards}
          newCards={totalCards}
          reviewCards={0}
          streak={0}
          dueCards={dueCards}
          studyHref={decks.length > 0 ? `/decks/${decks[0].id}/study` : undefined}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ font: "500 20px/28px var(--font-sans)", color: "var(--ink-700)", margin: 0 }}>
            Decks ({decks.length})
          </h2>
          <Link href="/decks" style={{ color: "var(--teal-700)", font: "500 14px/20px var(--font-sans)" }}>
            View all <i className="ri-arrow-right-s-line" />
          </Link>
        </div>

        <DeckTable decks={decks.slice(0, 10)} />
      </div>
    </>
  );
}
