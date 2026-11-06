"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { DeckCard, DeckListRow } from "@/components/community/community-deck-list";
import {
  CommunityPreviewPanel,
  type PreviewState,
} from "@/components/community/community-preview-panel";
import { OptionMenu } from "@/components/ui/option-menu";
import "@/components/community/community.css";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { UntitledSearchInput } from "@/components/ui/untitled-controls";
import { cacheKeys } from "@/lib/client-cache/keys";
import {
  COMMUNITY_SORT_OPTIONS,
  DEFAULT_COMMUNITY_SORT,
  buildCommunityListing,
  type CommunitySort,
} from "@/lib/community/sort-decks";
import type { CommunityDeckRow, SyncMode } from "@/lib/community/types";
import { useDeckViewMode } from "@/lib/ui/deck-view-mode";

const FEATURED_COUNT = 3;

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body.error ?? fallback;
}

export function CommunityView({
  initialDecks,
  initialQuery = "",
}: {
  initialDecks: CommunityDeckRow[];
  initialQuery?: string;
}) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { viewMode: view, setViewMode: setView } = useDeckViewMode();
  const listRef = useRef<HTMLDivElement>(null);
  const requestedPreviewRef = useRef<string | null>(null);
  const [decks, setDecks] = useState(initialDecks);
  const [q, setQ] = useState(initialQuery);
  const [sort, setSort] = useState<CommunitySort>(DEFAULT_COMMUNITY_SORT);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ratingBusyId, setRatingBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [syncMode, setSyncMode] = useState<SyncMode>("follow");
  const [unsubscribeTarget, setUnsubscribeTarget] = useState<CommunityDeckRow | null>(null);

  useEffect(() => {
    setQ(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setDecks(initialDecks);
  }, [initialDecks]);

  const previewId = preview?.deck.id ?? null;

  useEffect(() => {
    if (!previewId) return;
    listRef.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }, [previewId]);

  useEffect(() => {
    if (!previewId || unsubscribeTarget) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePreview();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [previewId, unsubscribeTarget]);

  const { all, featured, rest } = useMemo(
    () => buildCommunityListing(decks, { query: q, sort, featuredCount: FEATURED_COUNT }),
    [decks, q, sort],
  );

  function closePreview() {
    requestedPreviewRef.current = null;
    setPreview(null);
    setError(null);
  }

  function patchDeck(deckId: string, patch: (deck: CommunityDeckRow) => Partial<CommunityDeckRow>) {
    setDecks((prev) => prev.map((d) => (d.id === deckId ? { ...d, ...patch(d) } : d)));
    setPreview((prev) =>
      prev && prev.deck.id === deckId ? { ...prev, deck: { ...prev.deck, ...patch(prev.deck) } } : prev,
    );
  }

  // The list is served from a 60s deduped cache that Home reads too.
  function refreshCatalog() {
    void mutate(cacheKeys.communityDecks);
  }

  async function openPreview(deck: CommunityDeckRow) {
    if (previewId === deck.id) return;
    requestedPreviewRef.current = deck.id;
    setError(null);
    setSyncMode("follow");
    setPreview({ deck, cards: [], loading: true });
    try {
      const res = await fetch(`/api/community/decks/${deck.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to load preview"));
      const data = await res.json();
      // Another row may have been opened while this one loaded.
      if (requestedPreviewRef.current !== deck.id) return;
      const publication = data.publication ?? {};
      setPreview({
        deck: {
          ...deck,
          ...publication,
          is_subscribed: data.is_subscribed,
          subscription_sync_mode: data.subscription_sync_mode,
          local_project_id: data.local_project_id ?? deck.local_project_id,
          my_rating: data.my_rating ?? null,
          avg_rating: Number(publication.avg_rating ?? deck.avg_rating ?? 0),
          rating_count: Number(publication.rating_count ?? deck.rating_count ?? 0),
        },
        cards: data.previewCards ?? [],
        loading: false,
      });
    } catch (e) {
      if (requestedPreviewRef.current !== deck.id) return;
      requestedPreviewRef.current = null;
      setError(e instanceof Error ? e.message : "Failed to load preview");
      setPreview(null);
    }
  }

  async function saveRating(deck: CommunityDeckRow, stars: number | null) {
    if (deck.is_owner) return;
    const fallback = stars === null ? "Could not clear rating" : "Could not save rating";
    setRatingBusyId(deck.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/community/decks/${deck.id}/rating`,
        stars === null
          ? { method: "DELETE", credentials: "include" }
          : {
              method: "PUT",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stars }),
            },
      );
      if (!res.ok) throw new Error(await errorMessage(res, fallback));
      const data = await res.json();
      patchDeck(deck.id, () => ({
        my_rating: data.my_rating,
        avg_rating: data.avg_rating,
        rating_count: data.rating_count,
      }));
      refreshCatalog();
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setRatingBusyId(null);
    }
  }

  async function subscribe(deck: CommunityDeckRow, mode: SyncMode) {
    setBusyId(deck.id);
    setError(null);
    try {
      const res = await fetch(`/api/community/decks/${deck.id}/subscribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync_mode: mode }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Subscribe failed"));
      const data = await res.json();
      patchDeck(deck.id, (d) => ({
        is_subscribed: true,
        subscription_sync_mode: mode,
        local_project_id: data.localProjectId,
        subscriber_count: d.subscriber_count + 1,
      }));
      refreshCatalog();
      router.push(`/decks/${data.localProjectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Subscribe failed");
    } finally {
      setBusyId(null);
    }
  }

  async function unsubscribe(deck: CommunityDeckRow) {
    setUnsubscribeTarget(null);
    setBusyId(deck.id);
    setError(null);
    try {
      const res = await fetch(`/api/community/decks/${deck.id}/subscribe`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Unsubscribe failed"));
      patchDeck(deck.id, (d) => ({
        is_subscribed: false,
        subscription_sync_mode: null,
        subscriber_count: Math.max(0, d.subscriber_count - 1),
      }));
      refreshCatalog();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unsubscribe failed");
    } finally {
      setBusyId(null);
    }
  }

  const showFeatured = !preview && featured.length > 0;
  const listed = showFeatured ? rest : all;
  const compact = Boolean(preview);

  return (
    <div className={`dh-community${preview ? " dh-split" : ""}`}>
      <div className="dh-community__main" ref={listRef}>
        <div className="dh-page">
          <div className="dh-page-head">
            <h1 className="dh-title">Community</h1>
            <span className="dh-spacer" />
            <Link className="btn btn-secondary dh-community__share" href="/decks">
              Share a deck
            </Link>
          </div>

          <div className="dh-toolbar">
            <UntitledSearchInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search community decks..."
              aria-label="Search community decks"
            />
            <OptionMenu
              value={sort}
              options={COMMUNITY_SORT_OPTIONS}
              onChange={setSort}
              aria-label="Sort"
              prefix="Sort: "
              triggerClassName="btn btn-secondary dh-community__sort"
            />
            {compact ? null : (
              <div className="dh-seg dh-community__view" role="group" aria-label="Community deck view">
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={view === "table"}
                  title="List view"
                  onClick={() => setView("table")}
                >
                  <i className="ri-list-check" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label="Grid view"
                  aria-pressed={view === "grid"}
                  title="Grid view"
                  onClick={() => setView("grid")}
                >
                  <i className="ri-layout-grid-line" aria-hidden />
                </button>
              </div>
            )}
          </div>

          {error && !preview ? (
            <div className="dh-note dh-community-error dh-community-note" role="alert">
              <i className="ri-error-warning-line" aria-hidden />
              {error}
            </div>
          ) : null}

          {all.length === 0 ? (
            <div className="dh-empty">
              <h2>{decks.length === 0 ? "No community decks yet" : "No decks match your search"}</h2>
              <p>
                {decks.length === 0
                  ? "Publish one of your decks from its deck page, or check back later."
                  : "Try a different title."}
              </p>
            </div>
          ) : (
            <>
              {showFeatured ? (
                <>
                  <div className="dh-section-label dh-community-first-label">Featured</div>
                  <div className="dh-community-grid">
                    {featured.map((deck) => (
                      <DeckCard key={deck.id} deck={deck} onOpen={() => void openPreview(deck)} />
                    ))}
                  </div>
                  <div className="dh-section-label">All decks</div>
                </>
              ) : null}

              {view === "grid" && !compact ? (
                <div className="dh-community-grid">
                  {listed.map((deck) => (
                    <DeckCard key={deck.id} deck={deck} onOpen={() => void openPreview(deck)} />
                  ))}
                </div>
              ) : (
                <ul className="dh-community-list">
                  {listed.map((deck) => (
                    <DeckListRow
                      key={deck.id}
                      deck={deck}
                      active={deck.id === previewId}
                      compact={compact}
                      onOpen={() => void openPreview(deck)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>

      {preview ? (
        <CommunityPreviewPanel
          preview={preview}
          syncMode={syncMode}
          busy={busyId === preview.deck.id}
          ratingBusy={ratingBusyId === preview.deck.id}
          error={error}
          onSyncModeChange={setSyncMode}
          onClose={closePreview}
          onRate={(stars) => void saveRating(preview.deck, stars)}
          onClearRating={() => void saveRating(preview.deck, null)}
          onSubscribe={() => void subscribe(preview.deck, syncMode)}
          onUnsubscribe={() => setUnsubscribeTarget(preview.deck)}
        />
      ) : null}

      {unsubscribeTarget ? (
        <AnimatedModal
          title={`Unsubscribe from ${unsubscribeTarget.title}?`}
          onClose={() => setUnsubscribeTarget(null)}
          closeOnEscape
        >
          <div className="dh-community-confirm">
            <p>Your local copy stays in Decks.</p>
            <div className="dh-community-confirm__actions">
              <button type="button" className="btn btn-ghost" onClick={() => setUnsubscribeTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void unsubscribe(unsubscribeTarget)}
              >
                Unsubscribe
              </button>
            </div>
          </div>
        </AnimatedModal>
      ) : null}
    </div>
  );
}
