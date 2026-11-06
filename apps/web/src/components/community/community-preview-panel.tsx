"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import "@/components/rich-text/rich-text.css";
import { OptionMenu, type OptionMenuOption } from "@/components/ui/option-menu";
import {
  RelationPill,
  countLabel,
  deckRelation,
} from "@/components/community/community-deck-list";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import type { CommunityDeckRow, PublicationCard, SyncMode } from "@/lib/community/types";

export type PreviewState = {
  deck: CommunityDeckRow;
  cards: PublicationCard[];
  loading: boolean;
};

const SYNC_OPTIONS: Array<OptionMenuOption<SyncMode>> = [
  {
    value: "follow",
    label: "Follow updates",
    description:
      "Stay synced when the creator republishes. Your study progress is kept, but card content may change on updates.",
  },
  {
    value: "fork",
    label: "Make a personal copy",
    description: "Get a snapshot you can edit freely. You won't receive future updates from the creator.",
  },
];

function publicationCardFront(card: PublicationCard): string | null {
  if (card.type === "cloze") return card.cloze_text;
  return card.front;
}

function publicationCardAnswer(card: PublicationCard): string | null {
  if (card.type === "basic") return card.back ?? card.extra;
  return card.extra;
}

function StarRating({
  value,
  onChange,
  disabled = false,
}: {
  value: number | null;
  onChange?: (stars: number) => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value ?? 0;
  const interactive = Boolean(onChange) && !disabled;

  return (
    <div
      className="dh-community-stars"
      onMouseLeave={() => setHover(null)}
      role={interactive ? "radiogroup" : "img"}
      aria-label={value ? `Rated ${value} of 5 stars` : "Not rated"}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= display;
        return (
          <button
            key={star}
            type="button"
            disabled={!interactive}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            aria-checked={interactive ? value === star : undefined}
            role={interactive ? "radio" : undefined}
            onMouseEnter={() => {
              if (interactive) setHover(star);
            }}
            onFocus={() => {
              if (interactive) setHover(star);
            }}
            onBlur={() => setHover(null)}
            onClick={() => onChange?.(star)}
          >
            <i className={filled ? "ri-star-fill" : "ri-star-line"} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

function SampleCard({ card }: { card: PublicationCard }) {
  const front = publicationCardFront(card);
  const answer = publicationCardAnswer(card);
  return (
    <div className="dh-community-sample">
      <div className="dh-community-sample__front">
        {front?.trim() ? (
          <CardContentRenderer
            content={front}
            clozeMode={card.type === "cloze" ? "revealed" : "none"}
          />
        ) : (
          "No text on this side"
        )}
      </div>
      {answer?.trim() ? (
        <div className="dh-community-sample__back">
          <CardContentRenderer content={answer} />
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  preview: PreviewState;
  syncMode: SyncMode;
  busy: boolean;
  ratingBusy: boolean;
  error: string | null;
  onSyncModeChange: (mode: SyncMode) => void;
  onClose: () => void;
  onRate: (stars: number) => void;
  onClearRating: () => void;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
};

export function CommunityPreviewPanel({
  preview,
  syncMode,
  busy,
  ratingBusy,
  error,
  onSyncModeChange,
  onClose,
  onRate,
  onClearRating,
  onSubscribe,
  onUnsubscribe,
}: Props) {
  const { deck, cards, loading } = preview;
  const closeRef = useRef<HTMLButtonElement>(null);
  const relation = deckRelation(deck);
  const openDeckId = deck.is_owner ? deck.source_project_id : deck.local_project_id;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  return (
    <aside className="dh-panel dh-community-panel" aria-label="Deck preview">
      <div className="dh-panel__head">
        <RelationPill relation={relation} />
        {deck.is_subscribed && deck.subscription_sync_mode ? (
          <span className="dh-pill dh-pill--outline">
            {deck.subscription_sync_mode === "follow" ? "Following updates" : "Personal copy"}
          </span>
        ) : null}
        <span className="dh-spacer" />
        <button
          ref={closeRef}
          type="button"
          className="dh-community-close"
          aria-label="Close preview"
          onClick={onClose}
        >
          <i className="ri-close-line" aria-hidden />
        </button>
      </div>

      <div className="dh-panel__body">
        <h2 className="dh-community-panel__title">{deck.title}</h2>
        <p className="dh-community-panel__desc">
          {deck.description?.trim() || "No description yet."}
        </p>
        <div className="dh-community-panel__meta">
          <span>
            {countLabel(deck.card_count, "card")} · {countLabel(deck.subscriber_count, "subscriber")}{" "}
            ·
          </span>
          {deck.rating_count > 0 ? (
            <span className="dh-community-rating" title={countLabel(deck.rating_count, "rating")}>
              <i className="ri-star-fill" aria-hidden />
              {deck.avg_rating.toFixed(1)}
              <span className="dh-community-rating__count">({deck.rating_count.toLocaleString()})</span>
            </span>
          ) : (
            <span>No ratings</span>
          )}
        </div>

        <div className="dh-community-panel__rating">
          <span>Your rating</span>
          {deck.is_owner ? (
            <StarRating value={null} disabled />
          ) : (
            <StarRating value={deck.my_rating} disabled={ratingBusy || loading} onChange={onRate} />
          )}
          {!deck.is_owner && deck.my_rating != null ? (
            <button
              type="button"
              className="dh-community-link"
              onClick={onClearRating}
              disabled={ratingBusy}
            >
              Clear
            </button>
          ) : null}
        </div>
        {deck.is_owner ? (
          <p className="dh-community-panel__hint">You can&apos;t rate your own deck.</p>
        ) : null}

        <hr className="dh-community-panel__rule" />

        <div className="dh-section-label dh-community-panel__label">Sample cards</div>
        {loading ? (
          <div aria-busy="true" aria-label="Loading sample cards">
            {[0, 1].map((i) => (
              <div key={i} className="dh-community-sample">
                <SkeletonBar width="78%" height={15} />
                <SkeletonBar width="56%" height={13} style={{ marginTop: 18 }} />
              </div>
            ))}
          </div>
        ) : cards.length === 0 ? (
          <p className="dh-community-panel__hint">No cards yet</p>
        ) : (
          <>
            {cards.map((card, i) => (
              <SampleCard key={card.id ?? i} card={card} />
            ))}
            {deck.card_count > cards.length ? (
              <p className="dh-community-panel__hint">
                Showing {cards.length.toLocaleString()} of {deck.card_count.toLocaleString()} cards
              </p>
            ) : null}
          </>
        )}

        {error ? (
          <div className="dh-note dh-community-error" role="alert">
            <i className="ri-error-warning-line" aria-hidden />
            {error}
          </div>
        ) : null}
      </div>

      {relation === "community" ? (
        <div className="dh-panel__foot dh-community-panel__foot">
          <OptionMenu
            value={syncMode}
            options={SYNC_OPTIONS}
            onChange={onSyncModeChange}
            aria-label="How to add this deck"
            placement="above"
            className="dh-community-panel__mode"
            triggerClassName="dh-community-mode"
          />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onSubscribe}>
            {busy ? "Subscribing…" : "Subscribe"}
          </button>
        </div>
      ) : relation === "subscribed" || openDeckId ? (
        <div className="dh-panel__foot dh-community-panel__foot">
          <span className="dh-spacer" />
          {relation === "subscribed" ? (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={onUnsubscribe}>
              Unsubscribe
            </button>
          ) : null}
          {openDeckId ? (
            <Link className="btn btn-primary" href={`/decks/${openDeckId}`}>
              Open deck
            </Link>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
