"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { DeckActionsMenu } from "@/components/deck-actions-menu";
import { DeckForecastMini } from "@/components/deck-page/deck-forecast";
import { subscriberLabel } from "@/components/deck-page/deck-sharing-panel";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { swrFetcher } from "@/lib/client-cache/fetcher";
import { deckSummaryKey, type DeckSummary } from "@/lib/decks/deck-summary";
import { cardCountLabel, reviewedLabel, type DeckListRow } from "@/lib/decks/deck-list";
import { renameProject } from "@/lib/projects/rename";
import "@/components/browse/cards.css";

export type DeckPanelHandlers = {
  onRenamed: (deckId: string, name: string) => void;
  onDeleted: (deckId: string) => void;
  onDuplicated: (copy: { id: string; name: string; cardCount?: number }) => void;
  onPausedChange: (deckId: string, paused: boolean) => void;
};

/** The id once it has stopped changing, so holding an arrow key doesn't fetch every row. */
function useSettled<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

function plural(count: number, noun: string) {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The side panel for one deck: what to do with it and what is in it, without
 * leaving the list. `live` off skips the per-deck request (benchmark fixtures).
 */
export function DeckSummaryPanel({
  row,
  live,
  pauseBusy,
  handlers,
}: {
  row: DeckListRow;
  live: boolean;
  pauseBusy: boolean;
  handlers: DeckPanelHandlers;
}) {
  const settledId = useSettled(row.id, 160);
  const { data, error, mutate } = useSWR<DeckSummary>(
    live && settledId === row.id ? deckSummaryKey(row.id) : null,
    swrFetcher,
    { revalidateOnFocus: false },
  );
  const summary = data?.id === row.id ? data : undefined;
  const empty = row.total === 0;
  const studyCount = row.dueCount + row.newCount;
  const sourceCount = summary?.sources.length ?? 0;

  return (
    <aside className="dh-panel dh-panel--float dh-bench-panel dhk-panel" aria-label="Deck summary">
      <div className="dh-panel__head dh-bench-panel__head">
        <span className="dh-pill">{row.isCommunity ? "From Community" : "Created by you"}</span>
        {row.isPublished ? <span className="dh-pill dh-pill--accent">Published</span> : null}
        <span className="dh-spacer" />
        <Link href={`/decks/${row.id}`} className="btn btn-ghost btn-sm dhk-panel__open">
          Open deck
          <i className="ri-arrow-right-line" aria-hidden />
        </Link>
        {live ? (
          <DeckActionsMenu
            deck={{
              id: row.id,
              title: row.title,
              cardCount: row.total,
              isPublished: row.isPublished,
              isCommunity: row.isCommunity,
            }}
            omit={["open", "study"]}
            onRenamed={(name) => handlers.onRenamed(row.id, name)}
            onDeleted={handlers.onDeleted}
            onDuplicated={handlers.onDuplicated}
          />
        ) : null}
      </div>

      <div className="dh-panel__body dhk-panel__body">
        <div className="dhk-panel__intro">
          <DeckTitle key={row.id} row={row} onRenamed={(name) => handlers.onRenamed(row.id, name)} />
          <p className="dhk-panel__meta">
            {[
              cardCountLabel(row.total),
              sourceCount > 0 ? plural(sourceCount, "source") : null,
              reviewedLabel(row.lastReviewedRaw),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        {empty ? (
          <div className="dhk-panel__blank">
            <p>
              This deck has no cards. Add a source to make some, or delete it if it was left over
              from a run that failed.
            </p>
            <Link href={`/create?deck=${row.id}`} className="btn btn-primary">
              <i className="ri-add-line" aria-hidden />
              Add cards
            </Link>
          </div>
        ) : (
          <>
            <div className="dhk-panel__actions">
              <Link href={`/decks/${row.id}/study`} className="btn btn-primary dhk-panel__study">
                {studyCount > 0 ? `Study ${cardCountLabel(studyCount)}` : "Study ahead"}
              </Link>
              <Link href={`/create?deck=${row.id}`} className="btn btn-secondary">
                <i className="ri-add-line" aria-hidden />
                Add cards
              </Link>
            </div>

            <DeckProgress row={row} />

            {live ? (
              <section>
                <div className="dh-section-label dhk-panel__label">
                  Next 30 days
                  <span className="dh-spacer" />
                  <span>{plural(row.dueCount, "card")} due now</span>
                </div>
                {summary ? (
                  <DeckForecastMini
                    key={row.id}
                    projectId={row.id}
                    newPerDay={summary.settings.newCardsPerDay}
                    retention={summary.settings.desiredRetention}
                  />
                ) : (
                  <SkeletonBar height={52} radius={8} />
                )}
              </section>
            ) : null}

            <section>
              <div className="dh-section-label dhk-panel__label">
                Cards
                <span className="dh-spacer" />
                <Link href={`/cards?deck=${row.id}`}>Browse all {row.total.toLocaleString()}</Link>
              </div>
              {summary ? (
                summary.sampleCards.map((card) => (
                  <div key={card.id} className="dhk-peek">
                    <div className="dh-cards-row__question">
                      <CardContentRenderer
                        content={card.type === "cloze" ? card.cloze_text : card.front}
                        clozeMode={card.type === "cloze" ? "revealed" : "none"}
                      />
                    </div>
                    <div className="dh-cards-row__answer">
                      <CardContentRenderer
                        content={card.type === "basic" ? (card.back ?? card.extra) : card.extra}
                      />
                    </div>
                  </div>
                ))
              ) : live && !error ? (
                <PeekSkeleton />
              ) : null}
            </section>

            {summary && summary.sources.length > 0 ? (
              <section>
                <div className="dh-section-label dhk-panel__label">Sources</div>
                {summary.sources.map((source) => (
                  <div key={source.id} className="dhk-source">
                    <i className="ri-file-text-line" aria-hidden />
                    <span className="dhk-source__title">{source.title}</span>
                    <span className="dhk-source__count">{cardCountLabel(source.cardCount)}</span>
                  </div>
                ))}
              </section>
            ) : null}

            {summary?.subscription ? (
              <CommunityRating
                key={row.id}
                publicationId={summary.subscription.publication_id}
                syncMode={summary.subscription.sync_mode}
                rating={summary.subscription.my_rating}
                onRated={(stars) =>
                  void mutate(
                    (current) =>
                      current?.subscription
                        ? { ...current, subscription: { ...current.subscription, my_rating: stars } }
                        : current,
                    { revalidate: false },
                  )
                }
              />
            ) : null}

            {summary ? (
              <div className="dh-section-label dhk-panel__label dhk-panel__settings">
                {Math.round(summary.settings.desiredRetention * 100)}% retention ·{" "}
                {summary.settings.newCardsPerDay} new cards a day
                <span className="dh-spacer" />
                <Link href={`/decks/${row.id}?panel=settings`}>Edit</Link>
              </div>
            ) : null}

            {error && !summary ? (
              <p className="dhk-panel__hint">Couldn&apos;t load this deck&apos;s details.</p>
            ) : null}
          </>
        )}
      </div>

      <div className="dh-panel__foot dh-bench-panel__foot">
        <SharingState row={row} summary={summary} />
        <span className="dh-spacer" />
        <span className="dh-bench-switch">
          <span className="dh-bench-switch__label">{row.paused ? "Paused" : "Active"}</span>
          <button
            type="button"
            role="switch"
            className="dh-toggle"
            aria-checked={!row.paused}
            aria-label={row.paused ? "Paused, click to resume" : "Active, click to pause"}
            title={
              row.paused
                ? "Resume this deck"
                : "Pause this deck: it stays here but is left out of today's totals"
            }
            disabled={pauseBusy}
            onClick={() => handlers.onPausedChange(row.id, !row.paused)}
          />
        </span>
      </div>
    </aside>
  );
}

/** The deck name; click it to rename in place. */
function DeckTitle({ row, onRenamed }: { row: DeckListRow; onRenamed: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.title);
  /** The new name while it is being saved, so the old one doesn't flash back. */
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);

  async function save() {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const name = value.trim();
    if (!name || name === row.title) return;
    setError(null);
    setPending(name);
    try {
      await renameProject(row.id, name);
      onRenamed(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename deck.");
    } finally {
      setPending(null);
    }
  }

  if (editing) {
    return (
      <input
        className="dhk-panel__title-input"
        value={value}
        maxLength={120}
        aria-label="Deck name"
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <>
      <h2 className="dhk-panel__title">
        <button
          type="button"
          title="Rename"
          onClick={() => {
            setValue(row.title);
            setEditing(true);
          }}
        >
          {pending ?? row.title}
        </button>
      </h2>
      {error ? (
        <p className="dhk-panel__hint" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** How far through the deck the user is: studied and fine, due now, not started. */
function DeckProgress({ row }: { row: DeckListRow }) {
  const label = `${row.onTrackCount} on track, ${row.dueCount} due, ${row.unseenCount} not started`;
  return (
    <section>
      <div className="dhk-progress" role="img" aria-label={label}>
        <span style={{ flexGrow: row.onTrackCount }} className="dhk-progress__track" />
        <span style={{ flexGrow: row.dueCount }} className="dhk-progress__due" />
        <span style={{ flexGrow: row.unseenCount }} />
      </div>
      <div className="dhk-progress__legend">
        <span>
          <b>{row.onTrackCount.toLocaleString()}</b> on track
        </span>
        <span>
          <b>{row.dueCount.toLocaleString()}</b> due
        </span>
        <span>
          <b>{row.unseenCount.toLocaleString()}</b> not started
        </span>
      </div>
    </section>
  );
}

function PeekSkeleton() {
  return (
    <div aria-hidden>
      {[62, 48, 56].map((width) => (
        <div key={width} className="dhk-peek">
          <SkeletonBar width={`${width}%`} height={13} />
          <SkeletonBar width={`${width - 18}%`} height={11} style={{ marginTop: 7 }} />
        </div>
      ))}
    </div>
  );
}

function SharingState({ row, summary }: { row: DeckListRow; summary?: DeckSummary }) {
  if (row.isCommunity) {
    const mode = summary?.subscription?.sync_mode;
    return (
      <span className="dhk-panel__share">
        {mode === "fork" ? "Personal copy" : mode === "follow" ? "Following updates" : "From Community"}
      </span>
    );
  }
  if (row.isPublished) {
    return (
      <span className="dhk-panel__share">
        {summary?.publication ? subscriberLabel(summary.publication.subscriber_count) : "Published"}
        <Link href={`/decks/${row.id}?panel=sharing`}>Manage</Link>
      </span>
    );
  }
  return (
    <span className="dhk-panel__share">
      Private
      {row.total > 0 ? <Link href={`/decks/${row.id}?panel=sharing`}>Publish</Link> : null}
    </span>
  );
}

/** Rate a deck added from Community, now that the user has it. */
function CommunityRating({
  publicationId,
  syncMode,
  rating,
  onRated,
}: {
  publicationId: string;
  syncMode: "follow" | "fork";
  rating: number | null;
  onRated: (stars: number | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = hover ?? rating ?? 0;

  async function rate(stars: number) {
    if (busy) return;
    const next = stars === rating ? null : stars;
    setBusy(true);
    try {
      const res = await fetch(`/api/community/decks/${publicationId}/rating`, {
        method: next === null ? "DELETE" : "PUT",
        credentials: "include",
        headers: next === null ? undefined : { "Content-Type": "application/json" },
        body: next === null ? undefined : JSON.stringify({ stars: next }),
      });
      if (res.ok) onRated(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dhk-community">
      <span className="dhk-community__mode">
        {syncMode === "follow" ? "Follows the author's updates" : "Your own copy"}
      </span>
      <span className="dh-spacer" />
      <span>Your rating</span>
      <span
        className="dhk-stars"
        role="radiogroup"
        aria-label={rating ? `Rated ${rating} of 5 stars` : "Not rated"}
        onMouseLeave={() => setHover(null)}
      >
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={rating === star}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            disabled={busy}
            onMouseEnter={() => setHover(star)}
            onFocus={() => setHover(star)}
            onBlur={() => setHover(null)}
            onClick={() => void rate(star)}
          >
            <i className={star <= shown ? "ri-star-fill" : "ri-star-line"} aria-hidden />
          </button>
        ))}
      </span>
    </div>
  );
}
