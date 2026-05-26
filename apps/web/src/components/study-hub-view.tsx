"use client";

import Link from "next/link";
import { FadeIn } from "@/components/motion/fade-in";
import type { StudyDeckOption } from "@/lib/study/decks";

type Props = {
  decks: StudyDeckOption[];
};

export function StudyHubView({ decks }: Props) {
  const totalDue = decks.reduce((sum, d) => sum + d.due, 0);
  const totalNew = decks.reduce((sum, d) => sum + d.new, 0);

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
            Create Deck
          </Link>
        </div>
      </FadeIn>
    );
  }

  return (
    <FadeIn style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={s.summaryRow}>
        <div className="surface" style={s.summaryCard}>
          <div style={s.summaryLabel}>Due now</div>
          <div style={s.summaryValue}>{totalDue}</div>
        </div>
        <div className="surface" style={s.summaryCard}>
          <div style={s.summaryLabel}>New today</div>
          <div style={s.summaryValue}>{totalNew}</div>
        </div>
      </div>

      <section style={s.section}>
        <h2 style={s.sectionTitle}>Your decks</h2>
        <div style={s.deckList}>
          {decks.map((deck) => (
            <div key={deck.id} className="surface" style={s.deckRow}>
              <div style={s.deckMeta}>
                <div style={s.deckTitle}>{deck.title}</div>
                <div style={s.deckCounts}>
                  {deck.due > 0 && <span style={{ color: "var(--grade-hard)" }}>{deck.due} due</span>}
                  {deck.due > 0 && deck.new > 0 && <span style={s.dot}>·</span>}
                  {deck.new > 0 && <span style={{ color: "var(--teal-500)" }}>{deck.new} new</span>}
                  {deck.waiting === 0 && <span style={{ color: "var(--fg-4)" }}>All caught up</span>}
                </div>
              </div>
              {deck.waiting > 0 ? (
                <Link href={`/decks/${deck.id}/study`} className="btn btn-primary btn-sm">
                  Study
                </Link>
              ) : (
                <Link href={`/decks/${deck.id}`} className="btn btn-ghost btn-sm">
                  View deck
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>
    </FadeIn>
  );
}

const s: Record<string, React.CSSProperties> = {
  emptyWrap: { padding: "32px 40px" },
  emptyCard: {
    padding: 48,
    textAlign: "center",
    maxWidth: 520,
    margin: "40px auto 0",
  },
  summaryRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 16,
  },
  summaryCard: {
    padding: "20px 24px",
    borderRadius: 16,
  },
  summaryLabel: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--fg-3)",
  },
  summaryValue: {
    font: "600 32px/1.1 var(--font-sans)",
    color: "var(--ink-900)",
    marginTop: 8,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  sectionTitle: {
    font: "600 18px/24px var(--font-sans)",
    color: "var(--ink-900)",
    margin: 0,
  },
  deckList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  deckRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "16px 20px",
    borderRadius: 14,
  },
  deckMeta: {
    minWidth: 0,
    flex: 1,
  },
  deckTitle: {
    font: "600 15px/22px var(--font-sans)",
    color: "var(--ink-900)",
  },
  deckCounts: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    font: "500 13px/18px var(--font-sans)",
  },
  dot: {
    color: "var(--fg-4)",
  },
};
