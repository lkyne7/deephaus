"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FadeIn } from "@/components/motion/fade-in";
import { DeckGrid, type DeckGridRow } from "@/components/deck-grid";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { UntitledSearchInput, UntitledSelect } from "@/components/ui/untitled-controls";

type Props = {
  decks: DeckGridRow[];
  studyEntry?: boolean;
};

type SortKey = "priority" | "due" | "new" | "name-asc" | "name-desc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "priority", label: "Priority (due + new)" },
  { value: "due", label: "Most due" },
  { value: "new", label: "Most new" },
  { value: "name-asc", label: "Name (A–Z)" },
  { value: "name-desc", label: "Name (Z–A)" },
];

function sortDecks(decks: DeckGridRow[], sort: SortKey): DeckGridRow[] {
  const copy = [...decks];
  switch (sort) {
    case "due":
      return copy.sort((a, b) => b.dueCount - a.dueCount);
    case "new":
      return copy.sort((a, b) => b.newCount - a.newCount);
    case "name-asc":
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case "name-desc":
      return copy.sort((a, b) => b.title.localeCompare(a.title));
    case "priority":
    default:
      return copy.sort((a, b) => b.dueCount + b.newCount - (a.dueCount + a.newCount));
  }
}

export function StudyHubView({ decks, studyEntry = false }: Props) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("priority");

  const visibleDecks = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? decks.filter((d) => d.title.toLowerCase().includes(needle))
      : decks;
    return sortDecks(filtered, sort);
  }, [decks, query, sort]);

  if (decks.length === 0) {
    return (
      <FadeIn style={s.emptyWrap}>
        <div className="surface" style={s.emptyCard}>
          <i className="ri-book-open-line" style={{ fontSize: 40, color: "var(--ink-300)" }} />
          <h2 className="display-xs" style={{ marginTop: 16 }}>
            No decks to study
          </h2>
          <p style={{ color: "var(--fg-3)", marginTop: 8 }}>
            Create a deck and add cards to start reviewing.
          </p>
          <Link href="/decks/new" className="btn btn-primary" style={{ marginTop: 24 }}>
            Create deck
          </Link>
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <section key="decks">
        <DashboardSectionHeader
          title="Your decks"
          icon="ri-folder-3-line"
          count={decks.length}
        />

        <div style={s.toolbar}>
          <UntitledSearchInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search decks"
            aria-label="Search decks"
            wrapperStyle={s.search}
          />
          <UntitledSelect
            icon="ri-sort-desc"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort decks"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </UntitledSelect>
        </div>

        {visibleDecks.length === 0 ? (
          <div style={s.noMatches}>
            <i className="ri-search-line" style={{ fontSize: 28, color: "var(--ink-200)" }} />
            <div style={{ font: "500 15px/22px var(--font-sans)", color: "var(--ink-700)" }}>
              No decks match “{query.trim()}”
            </div>
          </div>
        ) : (
          <DeckGrid decks={visibleDecks} studyEntry={studyEntry} />
        )}
      </section>
    </FadeIn>
  );
}

const s: Record<string, React.CSSProperties> = {
  emptyWrap: { padding: 0 },
  emptyCard: {
    padding: 48,
    textAlign: "center",
    maxWidth: 520,
    margin: "40px auto 0",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    margin: "4px 0 16px",
  },
  search: {
    flex: "1 1 240px",
    minWidth: 200,
  },
  noMatches: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: "56px 24px",
    textAlign: "center",
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
  },
};
