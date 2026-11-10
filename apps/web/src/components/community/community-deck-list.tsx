"use client";

import { memo, type MouseEvent as ReactMouseEvent } from "react";
import { countLabel, learnerLabel } from "@/lib/community/labels";
import { contentUpdatedAt, updatedLabel } from "@/lib/community/sort-decks";
import type { CommunityDeckRow } from "@/lib/community/types";

export type DeckRelation = "owned" | "added" | "community";

export function deckRelation(deck: CommunityDeckRow): DeckRelation {
  if (deck.is_owner) return "owned";
  if (deck.is_subscribed) return "added";
  return "community";
}

export function RelationPill({ relation }: { relation: DeckRelation }) {
  if (relation === "owned") return <span className="dh-pill dh-pill--outline">Yours</span>;
  if (relation === "added") return <span className="dh-pill dh-pill--accent">In your decks</span>;
  return null;
}

export function DeckRating({ deck }: { deck: CommunityDeckRow }) {
  if (deck.rating_count <= 0) {
    return (
      <span className="dh-community-rating dh-community-rating--none" title="No ratings yet">
        New
      </span>
    );
  }
  return (
    <span className="dh-community-rating" title={countLabel(deck.rating_count, "rating")}>
      <i className="ri-star-fill" aria-hidden />
      {deck.avg_rating.toFixed(1)}
    </span>
  );
}

/** "412 cards · 1,820 learners · @maya · Updated 3 days ago" */
export function deckMetaLine(deck: CommunityDeckRow): string {
  return [
    countLabel(deck.card_count, "card"),
    learnerLabel(deck.subscriber_count),
    deck.author ? `@${deck.author}` : null,
    updatedLabel(contentUpdatedAt(deck)),
  ]
    .filter(Boolean)
    .join(" · ");
}

export const CommunityRow = memo(function CommunityRow({
  deck,
  index,
  setSize,
  focused,
  onClick,
}: {
  deck: CommunityDeckRow;
  index: number;
  setSize: number;
  focused: boolean;
  onClick: (deck: CommunityDeckRow, index: number, event: ReactMouseEvent) => void;
}) {
  return (
    <div
      role="listitem"
      aria-setsize={setSize}
      aria-posinset={index + 1}
      aria-current={focused ? "true" : undefined}
      data-publication-id={deck.id}
      className={`dh-bench-row dh-community-row${focused ? " is-selected" : ""}`}
      onClick={(e) => onClick(deck, index, e)}
    >
      <div className="dh-bench-row__body">
        <div className="dh-community-row__title">{deck.title}</div>
        <div className="dh-community-row__desc">{deck.description?.trim() || "No description"}</div>
        <div className="dh-community-row__meta">{deckMetaLine(deck)}</div>
      </div>
      <RelationPill relation={deckRelation(deck)} />
      <DeckRating deck={deck} />
    </div>
  );
});
