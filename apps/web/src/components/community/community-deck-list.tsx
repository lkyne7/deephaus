"use client";

import type { CommunityDeckRow } from "@/lib/community/types";

export type DeckRelation = "owned" | "subscribed" | "community";

export function deckRelation(deck: CommunityDeckRow): DeckRelation {
  if (deck.is_owner) return "owned";
  if (deck.is_subscribed) return "subscribed";
  return "community";
}

const RELATION_PILLS: Record<DeckRelation, { label: string; className: string }> = {
  owned: { label: "Your deck", className: "dh-pill dh-pill--outline" },
  subscribed: { label: "Subscribed", className: "dh-pill dh-pill--accent" },
  community: { label: "Community", className: "dh-pill" },
};

export function RelationPill({ relation }: { relation: DeckRelation }) {
  const { label, className } = RELATION_PILLS[relation];
  return <span className={className}>{label}</span>;
}

export function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

function DeckRating({ deck }: { deck: CommunityDeckRow }) {
  if (deck.rating_count <= 0) {
    return (
      <span className="dh-community-rating dh-community-rating--none" title="No ratings">
        <i className="ri-star-line" aria-hidden />
        <span className="dh-community-sr">No ratings</span>
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

type RowProps = {
  deck: CommunityDeckRow;
  active: boolean;
  /** Narrow form used beside the preview panel. */
  compact: boolean;
  onOpen: () => void;
};

export function DeckListRow({ deck, active, compact, onOpen }: RowProps) {
  const relation = deckRelation(deck);
  const description = deck.description?.trim();
  return (
    <li className={`dh-row dh-community-row${active ? " is-active" : ""}`}>
      <button
        type="button"
        className="dh-community-row__open"
        aria-current={active ? "true" : undefined}
        onClick={onOpen}
      >
        <span className="dh-community-row__title">{deck.title}</span>
        {compact ? (
          <span className="dh-community-row__sub">
            {countLabel(deck.card_count, "card")} · {countLabel(deck.subscriber_count, "subscriber")}
          </span>
        ) : description ? (
          <span className="dh-community-row__sub">{description}</span>
        ) : null}
      </button>
      {compact ? (
        relation !== "community" && <RelationPill relation={relation} />
      ) : (
        <>
          <span className="dh-community-row__stat dh-community-row__stat--cards">
            {countLabel(deck.card_count, "card")}
          </span>
          <span className="dh-community-row__stat dh-community-row__stat--subs">
            {countLabel(deck.subscriber_count, "sub")}
          </span>
        </>
      )}
      <span className={`dh-community-row__rating${compact ? " dh-community-row__rating--compact" : ""}`}>
        <DeckRating deck={deck} />
      </span>
      {compact ? null : (
        <span className="dh-community-row__action">
          {relation === "community" ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onOpen}>
              Subscribe
            </button>
          ) : (
            <RelationPill relation={relation} />
          )}
        </span>
      )}
    </li>
  );
}

export function DeckCard({ deck, onOpen }: { deck: CommunityDeckRow; onOpen: () => void }) {
  const relation = deckRelation(deck);
  const description = deck.description?.trim();
  return (
    <button type="button" className="dh-surface dh-community-card" onClick={onOpen}>
      <span className="dh-community-card__head">
        <span className="dh-community-card__title">{deck.title}</span>
        {relation !== "community" && <RelationPill relation={relation} />}
      </span>
      {description ? <span className="dh-community-card__desc">{description}</span> : null}
      <span className="dh-community-card__meta">
        <span>{countLabel(deck.card_count, "card")}</span>
        <span aria-hidden>·</span>
        <span>{countLabel(deck.subscriber_count, "subscriber")}</span>
        <span className="dh-spacer" />
        <DeckRating deck={deck} />
      </span>
    </button>
  );
}
