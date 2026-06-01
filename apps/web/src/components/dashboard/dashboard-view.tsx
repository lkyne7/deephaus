"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { FadeIn } from "@/components/motion/fade-in";
import { NewDeckMenu } from "@/components/new-deck-menu";
import { AdvancedStatsModal } from "@/components/dashboard/advanced-stats-modal";
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
  const [heatmapData, setHeatmapData] = useState(heatmapByYear);
  const [loadingHeatmapYear, setLoadingHeatmapYear] = useState<number | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsDeckId, setStatsDeckId] = useState<string | null>(null);

  const hasDecks = studyDecks.length > 0;
  const statsDeckOptions = useMemo(
    () => studyDecks.map((d) => ({ id: d.id, title: d.title })),
    [studyDecks],
  );

  const openStats = useCallback((deckId: string | null) => {
    setStatsDeckId(deckId);
    setStatsOpen(true);
  }, []);

  const handleOverviewClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!hasDecks) return;
      const target = event.target as HTMLElement;
      if (target.closest('select, option, a, button, input, label, [role="button"]')) return;
      openStats(null);
    },
    [hasDecks, openStats],
  );

  const heatmapCounts = heatmapData[heatmapYearState] ?? {};

  const handleHeatmapYearChange = useCallback(
    async (nextYear: number) => {
      setHeatmapYearState(nextYear);
      if (heatmapData[nextYear] !== undefined) return;
      setLoadingHeatmapYear(nextYear);
      try {
        const res = await fetch(`/api/stats/heatmap?year=${nextYear}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { year: number; counts: Record<string, number> };
        setHeatmapData((prev) => ({ ...prev, [json.year]: json.counts }));
      } catch {
        // Heatmap is non-critical; leave it empty.
      } finally {
        setLoadingHeatmapYear((current) => (current === nextYear ? null : current));
      }
    },
    [heatmapData],
  );

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
          <div style={s.overviewTitleGroup}>
            <h2 style={s.sectionTitle}>Overview</h2>
            {hasDecks ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => openStats(null)}
              >
                <i className="ri-bar-chart-2-line" />
                Stats
              </button>
            ) : null}
          </div>
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
              <NewDeckMenu size="sm" />
            )}
          </div>
        </div>

        <div
          style={{ ...s.overviewRow, cursor: hasDecks ? "pointer" : "default" }}
          onClick={handleOverviewClick}
          title={hasDecks ? "Open stats" : undefined}
        >
          <ReviewHeatmap
            year={heatmapYearState}
            counts={heatmapCounts}
            availableYears={heatmapYears}
            onYearChange={(y) => void handleHeatmapYearChange(y)}
            loading={loadingHeatmapYear === heatmapYearState}
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

      <AdvancedStatsModal
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        deckOptions={statsDeckOptions}
        initialDeckId={statsDeckId}
      />
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
  overviewTitleGroup: {
    display: "flex",
    alignItems: "center",
    gap: 12,
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
