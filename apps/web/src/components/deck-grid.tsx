"use client";

import { m } from "motion/react";
import Link from "next/link";
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

export function DeckGrid({
  decks,
  singleRow = false,
}: {
  decks: DeckGridRow[];
  singleRow?: boolean;
}) {
  if (decks.length === 0) {
    return (
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
    );
  }

  const gridStyle = singleRow
    ? {
        ...s.gridSingleRow,
        gridTemplateColumns: `repeat(${Math.max(decks.length, 1)}, minmax(200px, 1fr))`,
      }
    : s.grid;

  return (
    <StaggerList style={gridStyle}>
      {decks.map((deck) => (
        <StaggerItem key={deck.id} as="div">
          <m.article
            style={s.card}
            whileHover={{ backgroundColor: "var(--bg-surface-2)" }}
            transition={{ duration: 0.15 }}
          >
            <Link href={`/decks/${deck.id}`} style={s.cardTitleLink} title={deck.title}>
              <i className="ri-book-2-line" style={{ color: "var(--ink-400)", flexShrink: 0 }} />
              <span style={s.cardTitleText}>{deck.title}</span>
            </Link>

            <div style={s.badges}>
              {deck.totalCount !== undefined && (
                <span className="chip chip-neutral">
                  <i className="ri-stack-line" style={{ marginRight: 4 }} />
                  {deck.totalCount} cards
                </span>
              )}
              <span className="chip chip-due">
                <i className="ri-time-line" style={{ marginRight: 4 }} />
                {deck.dueCount} due
              </span>
              <span className="chip chip-new">
                <i className="ri-sparkling-line" style={{ marginRight: 4 }} />
                {deck.newCount} new
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
              <Link href={`/decks/${deck.id}`} className="btn btn-primary btn-sm">
                Open deck
              </Link>
            </div>
          </m.article>
        </StaggerItem>
      ))}
    </StaggerList>
  );
}

const s: Record<string, React.CSSProperties> = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: 16,
  },
  gridSingleRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(200px, 1fr))",
    gap: 16,
    overflowX: "auto",
    paddingBottom: 4,
  },
  card: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 8,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minHeight: 168,
  },
  cardTitleLink: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    textDecoration: "none",
    color: "var(--ink-900)",
    font: "600 15px/22px var(--font-sans)",
    minWidth: 0,
    overflow: "hidden",
  },
  cardTitleText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
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
    justifyContent: "flex-end",
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
    borderRadius: 8,
    textAlign: "center",
  },
};
