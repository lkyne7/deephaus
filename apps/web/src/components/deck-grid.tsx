"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FadeIn } from "@/components/motion/fade-in";
import { StaggerItem, StaggerList } from "@/components/motion/stagger-list";
import { useTheme } from "@/components/theme-provider";

export type DeckGridRow = {
  id: string;
  title: string;
  newCount: number;
  dueCount: number;
  totalCount?: number;
  lastReviewed: string | null;
  /** Deck is a subscribed community publication (cloned locally). */
  isCommunity?: boolean;
  /** Deck is published/shared to the community by the user. */
  isPublished?: boolean;
};

export function DeckGrid({
  decks,
  singleRow = false,
  studyEntry = false,
  studyButton = false,
}: {
  decks: DeckGridRow[];
  singleRow?: boolean;
  /** Link cards into the reviewer (study hub) instead of deck settings. */
  studyEntry?: boolean;
  /** Card opens the deck page while the action button starts a study session. */
  studyButton?: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const router = useRouter();

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
    <StaggerList key={resolvedTheme} style={gridStyle}>
      {decks.map((deck) => {
        const deckHref = `/decks/${deck.id}`;
        const studyHref = `/decks/${deck.id}/study`;
        // Where clicking the card body navigates.
        const cardHref = studyEntry ? studyHref : deckHref;
        // Where the primary action button navigates.
        const actionHref = studyEntry || studyButton ? studyHref : deckHref;
        const actionLabel = studyEntry ? "Study now" : studyButton ? "Study" : "Open deck";

        return (
        <StaggerItem key={deck.id} as="div">
          <article
            className="dh-deck-grid-card"
            style={s.card}
            role="link"
            tabIndex={0}
            title={deck.title}
            onClick={() => router.push(cardHref)}
            onKeyDown={(e) => {
              if (e.key === "Enter") router.push(cardHref);
            }}
          >
            <div style={s.cardTitleLink}>
              <i
                className={
                  deck.isCommunity
                    ? "ri-earth-line"
                    : deck.isPublished
                      ? "ri-share-forward-line"
                      : "ri-book-2-line"
                }
                style={{
                  color: deck.isCommunity
                    ? "#7c5cfc"
                    : deck.isPublished
                      ? "#3b82f6"
                      : "var(--ink-400)",
                  flexShrink: 0,
                }}
              />
              <span style={s.cardTitleText}>{deck.title}</span>
            </div>

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
              {(deck.isCommunity || deck.isPublished) && (
                <div style={s.cardTags}>
                  {deck.isCommunity && (
                    <span style={s.communityChip}>
                      <i className="ri-earth-line" style={{ marginRight: 4 }} />
                      Community
                    </span>
                  )}
                  {deck.isPublished && (
                    <span style={s.sharedChip}>
                      <i className="ri-share-forward-line" style={{ marginRight: 4 }} />
                      Shared
                    </span>
                  )}
                </div>
              )}
              <Link
                href={actionHref}
                className="btn btn-primary btn-sm"
                onClick={(e) => e.stopPropagation()}
              >
                {actionLabel}
              </Link>
            </div>
          </article>
        </StaggerItem>
        );
      })}
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
    border: "1px solid var(--border-secondary)",
    borderRadius: 8,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minHeight: 168,
    cursor: "pointer",
    outline: "none",
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
  communityChip: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    font: "500 12px/16px var(--font-sans)",
    background: "color-mix(in srgb, #7c5cfc 15%, transparent)",
    color: "#7c5cfc",
  },
  sharedChip: {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 8px",
    borderRadius: 999,
    font: "500 12px/16px var(--font-sans)",
    background: "color-mix(in srgb, #3b82f6 15%, transparent)",
    color: "#3b82f6",
  },
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
  cardTags: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginRight: "auto",
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
