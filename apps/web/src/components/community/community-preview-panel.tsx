"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardStudyPreviewDeck } from "@/components/card-study-preview";
import { RelationPill, deckRelation } from "@/components/community/community-deck-list";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import "@/components/rich-text/rich-text.css";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { ConfirmDialog } from "@/components/workbench/confirm-dialog";
import { fetchCommunityCards } from "@/lib/community/client";
import { cardMixLabel, countLabel, topicLabels } from "@/lib/community/labels";
import { contentUpdatedAt, updatedLabel } from "@/lib/community/sort-decks";
import { subjectLabel } from "@/lib/community/subjects";
import type {
  CommunityDeckRow,
  PublicationCard,
  PublicationFacts,
  SyncMode,
} from "@/lib/community/types";

/** Samples shown before "Show more", and how many each press adds. */
const SAMPLES_FIRST = 3;
const SAMPLES_STEP = 5;
/** How many cards "Try cards" steps through. */
const TRY_COUNT = 10;

function sampleFront(card: PublicationCard): string | null {
  if (card.type === "cloze") return card.cloze_text;
  return card.front;
}

function sampleAnswer(card: PublicationCard): string | null {
  if (card.type === "basic") return card.back ?? card.extra;
  return card.extra;
}

function SampleCard({ card }: { card: PublicationCard }) {
  const front = sampleFront(card);
  const answer = sampleAnswer(card);
  return (
    <div className="dh-community-sample">
      <div className="dh-community-sample__front">
        {front?.trim() ? (
          <CardContentRenderer content={front} clozeMode={card.type === "cloze" ? "revealed" : "none"} />
        ) : card.type === "image-occlusion" ? (
          "Image card"
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

function StarRating({
  value,
  disabled,
  onChange,
}: {
  value: number | null;
  disabled: boolean;
  onChange: (stars: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value ?? 0;
  return (
    <div
      className="dh-community-stars"
      role="radiogroup"
      aria-label={value ? `Your rating: ${value} of 5 stars` : "Rate this deck"}
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star === 1 ? "" : "s"}`}
          disabled={disabled}
          onMouseEnter={() => setHover(star)}
          onFocus={() => setHover(star)}
          onBlur={() => setHover(null)}
          onClick={() => onChange(star)}
        >
          <i className={star <= display ? "ri-star-fill" : "ri-star-line"} aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** "Add to my decks", with the other way to add behind the caret. */
function AddButton({ busy, onAdd }: { busy: boolean; onAdd: (mode: SyncMode) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(mode: SyncMode) {
    setOpen(false);
    onAdd(mode);
  }

  return (
    <div className="dh-community-add" ref={rootRef}>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => choose("follow")}>
        {busy ? "Adding…" : "Add to my decks"}
      </button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        aria-label="More ways to add"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="ri-arrow-down-s-line" aria-hidden />
      </button>
      {open ? (
        <div className="dh-community-add__menu" role="menu">
          <button type="button" role="menuitem" onClick={() => choose("follow")}>
            <b>Add and follow updates</b>
            <span>You get the author&apos;s changes. Your progress is kept.</span>
          </button>
          <button type="button" role="menuitem" onClick={() => choose("fork")}>
            <b>Add as a personal copy</b>
            <span>Yours to edit. It stays as it is today.</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  deck: CommunityDeckRow;
  /** The deck's first sample cards; undefined while they load. */
  cards: PublicationCard[] | undefined;
  facts: PublicationFacts | null | undefined;
  /** The samples could not be loaded. */
  failed: boolean;
  busy: boolean;
  ratingBusy: boolean;
  error: string | null;
  onAdd: (mode: SyncMode) => void;
  onStopFollowing: () => Promise<boolean>;
  onRate: (stars: number | null) => void;
  onEditListing: () => void;
};

/** The side panel for one published deck: what it is, what is in it, and adding it. */
export function CommunityPreviewPanel({
  deck,
  cards,
  facts,
  failed,
  busy,
  ratingBusy,
  error,
  onAdd,
  onStopFollowing,
  onRate,
  onEditListing,
}: Props) {
  const relation = deckRelation(deck);
  const [extra, setExtra] = useState<PublicationCard[]>([]);
  const [shown, setShown] = useState(SAMPLES_FIRST);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stopAsk, setStopAsk] = useState(false);
  const deckId = useRef(deck.id);
  deckId.current = deck.id;

  // Each deck starts from its first samples.
  useEffect(() => {
    setExtra([]);
    setShown(SAMPLES_FIRST);
    setLoadError(null);
    setTrying(false);
    setCopied(false);
    setStopAsk(false);
  }, [deck.id, deck.version]);

  const loaded = useMemo(() => [...(cards ?? []), ...extra], [cards, extra]);
  const visible = loaded.slice(0, shown);
  const tryCount = Math.min(TRY_COUNT, deck.card_count);
  const canShowMore = cards !== undefined && shown < deck.card_count;

  /** Make sure at least `count` cards are loaded; false when they could not be fetched. */
  async function ensureLoaded(count: number): Promise<boolean> {
    const want = Math.min(count, deck.card_count);
    if (loaded.length >= want) return true;
    const id = deck.id;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const more = await fetchCommunityCards(id, loaded.length, Math.max(SAMPLES_STEP, want - loaded.length));
      if (deckId.current !== id) return false;
      setExtra((prev) => [...prev, ...more]);
      return true;
    } catch (e) {
      if (deckId.current === id) setLoadError(e instanceof Error ? e.message : "Could not load more cards");
      return false;
    } finally {
      setLoadingMore(false);
    }
  }

  async function showMore() {
    const next = shown + SAMPLES_STEP;
    if (await ensureLoaded(next)) setShown(next);
  }

  async function tryCards() {
    if (await ensureLoaded(tryCount)) setTrying(true);
  }

  async function copyLink() {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("deck", deck.id);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setLoadError("Could not copy the link");
    }
  }

  const openDeckId = deck.is_owner ? deck.source_project_id : deck.local_project_id;
  const subject = subjectLabel(deck.subject);
  const mix = facts ? cardMixLabel(facts.types) : "";
  const topics = useMemo(() => topicLabels(facts?.tags ?? []), [facts]);
  const shownError = error ?? loadError;

  return (
    <aside className="dh-panel dh-panel--float dh-bench-panel dh-community-panel" aria-label="Deck preview">
      <div className="dh-panel__head dh-bench-panel__head">
        {subject ? <span className="dh-pill">{subject}</span> : null}
        <RelationPill relation={relation} />
        <span className="dh-spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyLink()}>
          <i className={copied ? "ri-check-line" : "ri-link"} aria-hidden />
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>

      <div className="dh-panel__body dh-community-panel__body">
        <section className="dh-community-panel__intro">
          <h2 className="dh-community-panel__title">{deck.title}</h2>
          <p className="dh-community-panel__desc">{deck.description?.trim() || "No description yet."}</p>
          <div className="dh-community-byline">
            {deck.author ? (
              <>
                <span className="dh-community-avatar" aria-hidden>
                  {deck.author.slice(0, 1)}
                </span>
                <b>@{deck.author}</b>
                <span>·</span>
              </>
            ) : null}
            <span>{updatedLabel(contentUpdatedAt(deck))}</span>
          </div>
        </section>

        <div className="dh-community-stats">
          <div>
            <b>{deck.card_count.toLocaleString()}</b>
            <span>{deck.card_count === 1 ? "card" : "cards"}</span>
          </div>
          <div>
            <b>{deck.subscriber_count.toLocaleString()}</b>
            <span>{deck.subscriber_count === 1 ? "learner" : "learners"}</span>
          </div>
          <div>
            {deck.rating_count > 0 ? (
              <>
                <b>
                  <i className="ri-star-fill" aria-hidden />
                  {deck.avg_rating.toFixed(1)}
                </b>
                <span>{countLabel(deck.rating_count, "rating")}</span>
              </>
            ) : (
              <>
                <b>New</b>
                <span>No ratings yet</span>
              </>
            )}
          </div>
        </div>

        {mix || topics.length > 0 ? (
          <section>
            <div className="dh-section-label dh-community-panel__label">Inside</div>
            {mix ? <p className="dh-community-panel__hint">{mix}</p> : null}
            {topics.length > 0 ? (
              <div className="dh-community-topics" style={mix ? { marginTop: 8 } : undefined}>
                {topics.map((tag) => (
                  <span key={tag} className="dh-pill dh-pill--outline">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <section>
          <div className="dh-section-label dh-community-panel__label">
            Sample cards
            <span className="dh-spacer" />
            {cards && cards.length > 0 ? (
              <button type="button" disabled={loadingMore} onClick={() => void tryCards()}>
                Try {tryCount === 1 ? "the card" : `${tryCount} cards`}
              </button>
            ) : null}
          </div>
          {cards === undefined ? (
            failed ? (
              <p className="dh-community-panel__hint">The sample cards could not be loaded.</p>
            ) : (
              <div className="dh-community-samples" aria-busy="true" aria-label="Loading sample cards">
                {[0, 1].map((i) => (
                  <div key={i} className="dh-community-sample">
                    <SkeletonBar width="78%" height={15} />
                    <SkeletonBar width="56%" height={13} style={{ marginTop: 18 }} />
                  </div>
                ))}
              </div>
            )
          ) : visible.length === 0 ? (
            <p className="dh-community-panel__hint">No cards yet.</p>
          ) : (
            <div className="dh-community-samples">
              {visible.map((card) => (
                <SampleCard key={card.id} card={card} />
              ))}
              {canShowMore ? (
                <div className="dh-community-more">
                  <span>
                    Showing {visible.length.toLocaleString()} of {deck.card_count.toLocaleString()}
                  </span>
                  <span className="dh-spacer" />
                  <button
                    type="button"
                    className="dh-community-link dh-community-link--strong"
                    disabled={loadingMore}
                    onClick={() => void showMore()}
                  >
                    {loadingMore ? "Loading…" : "Show more"}
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </section>

        {relation === "added" ? (
          <section className="dh-community-yours">
            <div className="dh-community-yours__row">
              <span>Your rating</span>
              <StarRating value={deck.my_rating} disabled={ratingBusy} onChange={onRate} />
              {deck.my_rating != null ? (
                <button
                  type="button"
                  className="dh-community-link"
                  disabled={ratingBusy}
                  onClick={() => onRate(null)}
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className="dh-community-yours__row">
              {deck.subscription_sync_mode === "follow" ? (
                <>
                  <span>You get the author&apos;s updates.</span>
                  <span className="dh-spacer" />
                  <button type="button" className="dh-community-link" disabled={busy} onClick={() => setStopAsk(true)}>
                    Stop following updates
                  </button>
                </>
              ) : (
                <span>A personal copy. It does not change when the author updates the deck.</span>
              )}
            </div>
          </section>
        ) : null}

        {shownError && !stopAsk ? (
          <div className="dh-note dh-community-error" role="alert">
            <i className="ri-error-warning-line" aria-hidden />
            {shownError}
          </div>
        ) : null}
      </div>

      {relation === "community" ? (
        <div className="dh-panel__foot dh-community-foot">
          <span className="dh-community-foot__note">Free. You can study it straight away.</span>
          <AddButton busy={busy} onAdd={onAdd} />
        </div>
      ) : relation === "added" ? (
        <div className="dh-panel__foot dh-community-foot">
          <span className="dh-community-foot__state">
            <i className="ri-checkbox-circle-fill" aria-hidden />
            In your decks
          </span>
          {openDeckId ? (
            <>
              <Link className="btn btn-secondary" href={`/decks/${openDeckId}`}>
                Open deck
              </Link>
              <Link className="btn btn-primary" href={`/decks/${openDeckId}/study`}>
                Study
              </Link>
            </>
          ) : null}
        </div>
      ) : (
        <div className="dh-panel__foot dh-community-foot">
          <span className="dh-community-foot__state">Published by you</span>
          <button type="button" className="btn btn-secondary" onClick={onEditListing}>
            Edit listing
          </button>
          <Link className="btn btn-primary" href={`/decks/${deck.source_project_id}`}>
            Open deck
          </Link>
        </div>
      )}

      <CardStudyPreviewDeck
        cards={loaded.slice(0, tryCount)}
        open={trying}
        onClose={() => setTrying(false)}
        title={deck.title}
      />

      <ConfirmDialog
        open={stopAsk}
        title="Stop following updates?"
        confirmLabel="Stop following"
        busy={busy}
        error={stopAsk ? error : null}
        onCancel={() => setStopAsk(false)}
        onConfirm={() => {
          void onStopFollowing().then((done) => {
            if (done) setStopAsk(false);
          });
        }}
      >
        <strong>{deck.title}</strong> stays in your decks with your progress, as a personal copy. It
        no longer changes when the author updates it. This can&apos;t be turned back on for this copy.
      </ConfirmDialog>
    </aside>
  );
}
