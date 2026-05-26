"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FadeIn } from "@/components/motion/fade-in";
import { CardStatePanel } from "@/components/dashboard/card-state-panel";
import { DeckGrid, type DeckGridRow } from "@/components/deck-grid";
import { ReviewHeatmap } from "@/components/dashboard/review-heatmap";
import type { StateBreakdown } from "@/components/stat-cards";

import type { StudyDeckOption } from "@/lib/study/decks";
import { pickDefaultStudyDeckId } from "@/lib/study/decks";

type Props = {
  reviewedToday: number;
  retentionPct: number | null;
  streak: number;
  dueNow: number;
  newToday: number;
  totalCards: number;
  stateBreakdown: StateBreakdown;
  studyDecks: StudyDeckOption[];
  defaultStudyDeckId: string | null;
  heatmapYear: number;
  heatmapByYear: Record<number, Record<string, number>>;
  heatmapYears: number[];
  decks: DeckGridRow[];
};

function pickDefaultDeckId(decks: StudyDeckOption[]): string | null {
  return pickDefaultStudyDeckId(decks);
}

export function DashboardView({
  reviewedToday,
  retentionPct,
  streak,
  dueNow,
  newToday,
  totalCards,
  stateBreakdown,
  studyDecks,
  defaultStudyDeckId,
  heatmapYear,
  heatmapByYear,
  heatmapYears,
  decks,
}: Props) {
  const [selectedDeckId, setSelectedDeckId] = useState(
    defaultStudyDeckId ?? pickDefaultDeckId(studyDecks),
  );
  const [heatmapYearState, setHeatmapYearState] = useState(heatmapYear);

  const heatmapCounts = heatmapByYear[heatmapYearState] ?? {};

  const selectedDeck = useMemo(
    () => studyDecks.find((d) => d.id === selectedDeckId) ?? null,
    [studyDecks, selectedDeckId],
  );

  const waiting = selectedDeck ? selectedDeck.due + selectedDeck.new : dueNow + newToday;
  const canStudy = Boolean(selectedDeckId && waiting > 0);

  return (
    <FadeIn style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <section>
        <div style={s.overviewHeader}>
          <h2 style={s.sectionTitle}>Overview</h2>
          <div style={s.studyControls}>
            {studyDecks.length > 0 ? (
              <>
                <label htmlFor="study-deck-select" style={s.deckSelectLabel}>
                  Deck
                </label>
                <select
                  id="study-deck-select"
                  value={selectedDeckId ?? ""}
                  onChange={(e) => setSelectedDeckId(e.target.value)}
                  style={s.deckSelect}
                >
                  {studyDecks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                      {d.due + d.new > 0 ? ` (${d.due} due · ${d.new} new)` : ""}
                    </option>
                  ))}
                </select>
                {canStudy ? (
                  <Link href={`/decks/${selectedDeckId}/study`} className="btn btn-primary btn-sm">
                    Study Now <i className="ri-arrow-right-line" />
                  </Link>
                ) : (
                  <Link href="/study?deck=pick" className="btn btn-secondary btn-sm">
                    Study hub
                  </Link>
                )}
              </>
            ) : (
              <Link href="/decks/new" className="btn btn-primary btn-sm">
                Create your first deck
              </Link>
            )}
          </div>
        </div>

        <div style={s.overviewRow}>
          <ReviewHeatmap
            year={heatmapYearState}
            counts={heatmapCounts}
            availableYears={heatmapYears}
            onYearChange={setHeatmapYearState}
          />
          <CardStatePanel
            totalCards={totalCards}
            breakdown={stateBreakdown}
            streak={streak}
            reviewedToday={reviewedToday}
            cardsWaiting={dueNow + newToday}
            retentionPct={retentionPct}
          />
        </div>
      </section>

      <section>
        <div style={s.decksHeader}>
          <h2 style={s.sectionTitle}>Decks ({decks.length})</h2>
          <Link href="/decks" style={s.viewAllLink}>
            View all <i className="ri-arrow-right-s-line" />
          </Link>
        </div>
        <DeckGrid decks={decks} />
      </section>
    </FadeIn>
  );
}

const s: Record<string, React.CSSProperties> = {
  sectionTitle: {
    font: "500 18px/24px var(--font-sans)",
    color: "var(--ink-700)",
    margin: 0,
  },
  overviewHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  studyControls: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  deckSelectLabel: {
    font: "500 13px/20px var(--font-sans)",
    color: "var(--fg-4)",
  },
  deckSelect: {
    minWidth: 200,
    maxWidth: 320,
    font: "500 14px/20px var(--font-sans)",
    color: "var(--ink-700)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    padding: "8px 12px",
    background: "var(--white)",
  },
  overviewRow: {
    display: "flex",
    gap: 16,
    alignItems: "stretch",
    flexWrap: "wrap",
  },
  decksHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  viewAllLink: {
    color: "var(--teal-700)",
    font: "500 14px/20px var(--font-sans)",
    textDecoration: "none",
  },
};
