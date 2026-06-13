"use client";

import Link from "next/link";
import { FadeIn } from "@/components/motion/fade-in";
import { DeckGrid, type DeckGridRow } from "@/components/deck-grid";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";

type Props = {
  decks: DeckGridRow[];
  studyEntry?: boolean;
};

export function StudyHubView({ decks, studyEntry = false }: Props) {
  const totalDue = decks.reduce((sum, d) => sum + d.dueCount, 0);
  const totalNew = decks.reduce((sum, d) => sum + d.newCount, 0);

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
      <div key="summary" style={s.summaryRow}>
        <div className="surface" style={s.summaryCard}>
          <div style={s.summaryLabel}>Due now</div>
          <div style={s.summaryValue}>{totalDue}</div>
        </div>
        <div className="surface" style={s.summaryCard}>
          <div style={s.summaryLabel}>New today</div>
          <div style={s.summaryValue}>{totalNew}</div>
        </div>
      </div>

      <section key="decks">
        <DashboardSectionHeader
          title="Your decks"
          icon="ri-folder-3-line"
          count={decks.length}
        />
        <DeckGrid decks={decks} studyEntry={studyEntry} />
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
  summaryRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 16,
  },
  summaryCard: {
    padding: "16px 20px",
    borderRadius: 8,
  },
  summaryLabel: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--fg-3)",
  },
  summaryValue: {
    font: "600 24px/1.2 var(--font-sans)",
    color: "var(--ink-900)",
    marginTop: 6,
    letterSpacing: "-0.02em",
  },
};
