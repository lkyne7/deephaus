"use client";

import { m } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { DeckOverviewModal } from "@/components/deck-overview-modal";
import { FadeIn } from "@/components/motion/fade-in";
import { StaggerItem, StaggerList } from "@/components/motion/stagger-list";

export type DeckGridRow = {
  id: string;
  title: string;
  newCount: number;
  dueCount: number;
  totalCount?: number;
  lastReviewed: string | null;
};

export function DeckGrid({ decks }: { decks: DeckGridRow[] }) {
  const [overviewDeckId, setOverviewDeckId] = useState<string | null>(null);

  function openOverview(deckId: string) {
    setOverviewDeckId(deckId);
  }

  if (decks.length === 0) {
    return (
      <>
        <FadeIn>
          <div style={s.empty}>
            <i className="ri-folder-line" style={{ fontSize: 40, color: "var(--ink-200)" }} />
            <div style={{ font: "500 16px/24px var(--font-sans)", color: "var(--ink-700)" }}>
              You haven&apos;t created any decks
            </div>
            <div style={{ font: "400 14px/20px var(--font-sans)", color: "var(--fg-4)" }}>
              Paste any resource and let DeepHaus turn it into flashcards.
            </div>
          </div>
        </FadeIn>
        <DeckOverviewModal deckId={overviewDeckId} onClose={() => setOverviewDeckId(null)} />
      </>
    );
  }

  return (
    <>
      <StaggerList style={s.grid}>
        {decks.map((deck) => {
          const canStudy = deck.newCount + deck.dueCount > 0;
          return (
            <StaggerItem key={deck.id} as="div">
              <m.article
                style={s.card}
                whileHover={{ y: -2, boxShadow: "var(--shadow-sm)" }}
                transition={{ duration: 0.18 }}
              >
                <button
                  type="button"
                  style={s.cardTitleBtn}
                  onClick={() => openOverview(deck.id)}
                >
                  <i className="ri-book-2-line" style={{ color: "var(--ink-400)", flexShrink: 0 }} />
                  <span>{deck.title}</span>
                </button>

                <div style={s.badges}>
                  {deck.totalCount !== undefined && (
                    <span className="chip chip-neutral">
                      <i className="ri-stack-line" style={{ marginRight: 4 }} />
                      {deck.totalCount} CARDS
                    </span>
                  )}
                  <span className="chip chip-due">
                    <i className="ri-time-line" style={{ marginRight: 4 }} />
                    {deck.dueCount} DUE
                  </span>
                  <span className="chip chip-new">
                    <i className="ri-sparkling-line" style={{ marginRight: 4 }} />
                    {deck.newCount} NEW
                  </span>
                </div>

                {deck.lastReviewed ? (
                  <div style={s.lastReviewed}>
                    <i className="ri-calendar-line" />
                    Last reviewed {deck.lastReviewed}
                  </div>
                ) : (
                  <div style={{ ...s.lastReviewed, color: "var(--fg-5)" }}>Not reviewed yet</div>
                )}

                <div style={s.cardActions}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => openOverview(deck.id)}
                  >
                    Open
                  </button>
                  {canStudy ? (
                    <Link href={`/decks/${deck.id}/study`} className="btn btn-primary btn-sm">
                      Study
                    </Link>
                  ) : (
                    <button className="btn btn-secondary btn-sm" disabled type="button">
                      Caught up
                    </button>
                  )}
                </div>
              </m.article>
            </StaggerItem>
          );
        })}
      </StaggerList>
      <DeckOverviewModal deckId={overviewDeckId} onClose={() => setOverviewDeckId(null)} />
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: 16,
  },
  card: {
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minHeight: 168,
  },
  cardTitleBtn: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    border: 0,
    background: "transparent",
    padding: 0,
    textAlign: "left",
    cursor: "pointer",
    font: "600 15px/22px var(--font-sans)",
    color: "var(--ink-900)",
  },
  badges: { display: "flex", flexWrap: "wrap", gap: 8 },
  lastReviewed: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  cardActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "auto",
    gap: 8,
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "80px 24px",
    gap: 8,
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    textAlign: "center",
  },
};
