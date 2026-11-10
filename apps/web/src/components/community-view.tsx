"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import useSWR, { useSWRConfig } from "swr";
import { CommunityRow } from "@/components/community/community-deck-list";
import { CommunityPreviewPanel } from "@/components/community/community-preview-panel";
import { PublishForm } from "@/components/community/publish-form";
import { UntitledMenuSelect } from "@/components/ui/untitled-controls";
import { handleListKeyDown, useSlashToSearch } from "@/components/workbench/list-keyboard";
import { useListSelection } from "@/components/workbench/use-list-selection";
import { swrFetcher } from "@/lib/client-cache/fetcher";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";
import { cacheKeys } from "@/lib/client-cache/keys";
import { invalidateDeckCaches } from "@/lib/client-cache/prefetch";
import {
  addCommunityDeck,
  communityDeckKey,
  fetchCommunityCatalog,
  rateCommunityDeck,
  stopFollowingCommunityDeck,
  type CommunityDeckDetail,
} from "@/lib/community/client";
import { countLabel } from "@/lib/community/labels";
import {
  COMMUNITY_SORT_OPTIONS,
  DEFAULT_COMMUNITY_SORT,
  visibleCommunityDecks,
  type CommunitySort,
} from "@/lib/community/sort-decks";
import { COMMUNITY_SUBJECTS } from "@/lib/community/subjects";
import type { CommunityDeckRow, DeckPublication, SyncMode } from "@/lib/community/types";
import "@/components/workbench/workbench.css";
import "@/components/community/community.css";

/** What the side panel is showing: the focused deck, or a listing being written. */
type PanelMode =
  | { kind: "browse" }
  | {
      kind: "listing";
      /** The user's own deck behind the listing; null until one is chosen. */
      projectId: string | null;
      /** Started from "Publish a deck", so the deck can still be changed. */
      picking: boolean;
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

export function CommunityView({
  initialDecks,
  initialQuery = "",
  selectedId = null,
}: {
  initialDecks: CommunityDeckRow[];
  initialQuery?: string;
  /** The deck to open the page on (`/community?deck=`). */
  selectedId?: string | null;
}) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { data: stats } = useDashboardStats();
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const appliedSelection = useRef<string | null>(null);
  const [decks, setDecks] = useState(initialDecks);
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<CommunitySort>(DEFAULT_COMMUNITY_SORT);
  const [subject, setSubject] = useState("");
  const [mode, setMode] = useState<PanelMode>({ kind: "browse" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ratingBusyId, setRatingBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useSlashToSearch(searchRef);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setDecks(initialDecks);
  }, [initialDecks]);

  // Only subjects that have a deck get a chip.
  const subjects = useMemo(
    () => COMMUNITY_SUBJECTS.filter((option) => decks.some((deck) => deck.subject === option.value)),
    [decks],
  );
  const activeSubject = subjects.some((option) => option.value === subject) ? subject : "";

  const visible = useMemo(
    () => visibleCommunityDecks(decks, { query, sort, subject: activeSubject || undefined }),
    [decks, query, sort, activeSubject],
  );

  const { focusedId, focused, focusOnly, moveFocus } = useListSelection(visible);

  // Open on the deck named in the URL. One that isn't listed (unpublished) is dropped.
  useEffect(() => {
    if (!selectedId || appliedSelection.current === selectedId) return;
    focusOnly(selectedId);
    appliedSelection.current = selectedId;
  }, [selectedId, focusOnly]);

  // Keep `?deck=` on the focused deck, so the address can be shared.
  useEffect(() => {
    if (!focusedId) return;
    if (selectedId && appliedSelection.current !== selectedId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("deck") === focusedId) return;
    appliedSelection.current = focusedId;
    url.searchParams.set("deck", focusedId);
    // A string, not the URL object: the service worker's navigation hook posts
    // this argument to a worker, and a URL object can't be cloned.
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [focusedId, selectedId]);

  useEffect(() => {
    setError(null);
    if (!focusedId) return;
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [focusedId]);

  const settledId = useSettled(focusedId, 160);
  const detailKey =
    mode.kind === "browse" && focusedId && settledId === focusedId ? communityDeckKey(focusedId) : null;
  const { data: detailData, error: detailError } = useSWR<CommunityDeckDetail>(detailKey, swrFetcher, {
    revalidateOnFocus: false,
  });
  const detail = detailData && detailData.publication.id === focusedId ? detailData : undefined;

  const patchRow = useCallback(
    (deckId: string, patch: (deck: CommunityDeckRow) => Partial<CommunityDeckRow>) => {
      setDecks((prev) => prev.map((deck) => (deck.id === deckId ? { ...deck, ...patch(deck) } : deck)));
    },
    [],
  );

  // The deck's own request is fresher than the list, which is cached for a minute.
  useEffect(() => {
    if (!detail) return;
    const publication = detail.publication;
    patchRow(publication.id, () => publication);
  }, [detail, patchRow]);

  /** Apply the result of an action to the row and to the deck's cached request. */
  function patchDeck(deckId: string, patch: (deck: CommunityDeckRow) => Partial<CommunityDeckRow>) {
    patchRow(deckId, patch);
    void mutate(
      communityDeckKey(deckId),
      (current: CommunityDeckDetail | undefined) =>
        current ? { ...current, publication: { ...current.publication, ...patch(current.publication) } } : current,
      { revalidate: false },
    );
  }

  // Home reads this list too. Handing SWR the request itself, rather than asking
  // it to revalidate, means an older refresh still in flight can't land on top.
  function refreshCatalog() {
    void mutate(cacheKeys.communityDecks, fetchCommunityCatalog(), { revalidate: false }).catch(
      () => undefined,
    );
  }

  async function addDeck(deck: CommunityDeckRow, syncMode: SyncMode) {
    setBusyId(deck.id);
    setError(null);
    try {
      const { localProjectId } = await addCommunityDeck(deck.id, syncMode);
      patchDeck(deck.id, (current) => ({
        is_subscribed: true,
        subscription_sync_mode: syncMode,
        local_project_id: localProjectId,
        subscriber_count: current.is_subscribed ? current.subscriber_count : current.subscriber_count + 1,
      }));
      invalidateDeckCaches();
      refreshCatalog();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add this deck");
    } finally {
      setBusyId(null);
    }
  }

  async function stopFollowing(deck: CommunityDeckRow): Promise<boolean> {
    setBusyId(deck.id);
    setError(null);
    try {
      await stopFollowingCommunityDeck(deck.id);
      patchDeck(deck.id, () => ({ subscription_sync_mode: "fork" }));
      refreshCatalog();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update this deck");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function rate(deck: CommunityDeckRow, stars: number | null) {
    setRatingBusyId(deck.id);
    setError(null);
    try {
      const data = await rateCommunityDeck(deck.id, stars);
      patchDeck(deck.id, () => ({
        my_rating: data.my_rating,
        avg_rating: Number(data.avg_rating ?? 0),
        rating_count: Number(data.rating_count ?? 0),
      }));
      refreshCatalog();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save rating");
    } finally {
      setRatingBusyId(null);
    }
  }

  // Decks the user made, with cards, that aren't listed yet.
  const ownDecks = stats?.per_deck;
  const eligible = useMemo(
    () => (ownDecks ?? []).filter((deck) => !deck.is_community && !deck.is_published && deck.total > 0),
    [ownDecks],
  );

  // "Publish a deck" starts on the first deck that can be published.
  const firstEligibleId = eligible[0]?.deck_id ?? null;
  useEffect(() => {
    if (mode.kind !== "listing" || !mode.picking || mode.projectId || !firstEligibleId) return;
    setMode({ kind: "listing", projectId: firstEligibleId, picking: true });
  }, [mode, firstEligibleId]);

  function startPublishing() {
    setError(null);
    setMode({ kind: "listing", projectId: firstEligibleId, picking: true });
  }

  const listingProjectId = mode.kind === "listing" ? mode.projectId : null;
  const listingPublication = listingProjectId
    ? (decks.find((deck) => deck.is_owner && deck.source_project_id === listingProjectId) ?? null)
    : null;
  const listingDeck = listingProjectId
    ? (ownDecks?.find((deck) => deck.deck_id === listingProjectId) ?? null)
    : null;

  function onListingChange(projectId: string, next: DeckPublication | null) {
    const before = decks.find((deck) => deck.is_owner && deck.source_project_id === projectId);
    if (!next) {
      setDecks((prev) => prev.filter((deck) => deck !== before));
      setMode({ kind: "browse" });
    } else {
      const row: CommunityDeckRow = {
        is_subscribed: false,
        subscription_sync_mode: null,
        local_project_id: null,
        my_rating: null,
        ...before,
        ...next,
        avg_rating: Number(next.avg_rating ?? 0),
        rating_count: Number(next.rating_count ?? 0),
        is_owner: true,
      };
      setDecks((prev) => (before ? prev.map((deck) => (deck === before ? row : deck)) : [row, ...prev]));
      void mutate(communityDeckKey(next.id));
    }
    // Publishing or unpublishing changes the deck's "Published" mark everywhere.
    if (Boolean(before) !== Boolean(next)) invalidateDeckCaches();
    refreshCatalog();
  }

  function clearFilters() {
    setQuery("");
    setSubject("");
  }

  function onListKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    handleListKeyDown(e, {
      moveFocus: (delta) => {
        setMode({ kind: "browse" });
        moveFocus(delta);
      },
      toggleFocused: () => undefined,
      selectAll: () => undefined,
      clearSelection: () => setMode({ kind: "browse" }),
      homeEnd: true,
      onOpen: () => {
        const deckId = focused?.is_owner ? focused.source_project_id : focused?.local_project_id;
        if (deckId) router.push(`/decks/${deckId}`);
      },
    });
  }

  const onRowClick = useCallback(
    (deck: CommunityDeckRow) => {
      setMode({ kind: "browse" });
      focusOnly(deck.id);
    },
    [focusOnly],
  );

  const hasFilters = Boolean(query.trim() || activeSubject);
  const pickerOptions = useMemo(() => {
    const options = eligible.map((deck) => ({ value: deck.deck_id, label: deck.name }));
    // A deck that was just published stays in the picker while it is being edited.
    if (listingProjectId && !options.some((option) => option.value === listingProjectId)) {
      options.unshift({
        value: listingProjectId,
        label: listingDeck?.name ?? listingPublication?.title ?? "This deck",
      });
    }
    return options;
  }, [eligible, listingProjectId, listingDeck, listingPublication]);

  return (
    <div className="dh-bench dh-community">
      <div className="dh-bench-main">
        <div className="dh-bench-top">
          <div className="dh-bench-head">
            <h1 className="dh-title">Community</h1>
            <button type="button" className="btn btn-secondary" onClick={startPublishing}>
              <i className="ri-upload-2-line" aria-hidden />
              Publish a deck
            </button>
          </div>
          <label className="untitled-search dh-bench-search">
            <i className="ri-search-line" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              className="untitled-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                decks.length > 0
                  ? `Search ${countLabel(decks.length, "community deck")}…`
                  : "Search community decks…"
              }
              aria-label="Search community decks"
            />
            <kbd className="dh-kbd">/</kbd>
          </label>
          <div className="dh-bench-filters">
            {subjects.length > 0 ? (
              <div className="dh-community-subjects" role="group" aria-label="Subject">
                <button
                  type="button"
                  className="dh-filter"
                  aria-pressed={!activeSubject}
                  onClick={() => setSubject("")}
                >
                  All
                </button>
                {subjects.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="dh-filter"
                    aria-pressed={activeSubject === option.value}
                    onClick={() => setSubject(activeSubject === option.value ? "" : option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            <span className="dh-spacer" />
            <span className="dh-bench-count">{countLabel(visible.length, "deck")}</span>
            <div className="dh-bench-filter" data-active={sort !== DEFAULT_COMMUNITY_SORT ? "" : undefined}>
              <UntitledMenuSelect
                icon="ri-arrow-up-down-line"
                value={sort}
                onChange={(value) => setSort(value as CommunitySort)}
                aria-label="Sort community decks"
                menuWidth={210}
                options={COMMUNITY_SORT_OPTIONS}
              />
            </div>
          </div>
        </div>

        <div
          ref={listRef}
          className="dh-bench-list"
          tabIndex={0}
          role="list"
          aria-label="Community decks"
          onKeyDown={onListKeyDown}
        >
          {visible.length === 0 ? (
            <div className="dh-empty">
              <h2>{decks.length === 0 ? "No community decks yet" : "No decks match"}</h2>
              <p>
                {decks.length === 0
                  ? "Be the first to share one of your decks."
                  : "Try another search or subject."}
              </p>
              {decks.length === 0 ? (
                <button type="button" className="btn btn-secondary" onClick={startPublishing}>
                  Publish a deck
                </button>
              ) : hasFilters ? (
                <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {visible.map((deck, index) => (
                <CommunityRow
                  key={deck.id}
                  deck={deck}
                  index={index}
                  setSize={visible.length}
                  focused={mode.kind === "browse" && deck.id === focusedId}
                  onClick={onRowClick}
                />
              ))}
              <div className="dh-community-nudge">
                <span>Have a deck worth sharing?</span>
                <button
                  type="button"
                  className="dh-community-link dh-community-link--strong"
                  onClick={startPublishing}
                >
                  Publish it
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {mode.kind === "listing" ? (
        <aside
          className="dh-panel dh-panel--float dh-bench-panel dh-community-panel"
          aria-label={listingPublication ? "Edit listing" : "Publish a deck"}
        >
          <div className="dh-panel__head dh-bench-panel__head">
            <b className="dh-bench-panel__title">{listingPublication ? "Edit listing" : "Publish a deck"}</b>
            <span className="dh-spacer" />
            <button
              type="button"
              className="dh-bench-iconbtn"
              aria-label="Close"
              onClick={() => setMode({ kind: "browse" })}
            >
              <i className="ri-close-line" aria-hidden />
            </button>
          </div>
          {mode.picking && !listingPublication && pickerOptions.length > 0 ? (
            <div className="dh-publish__picker">
              <span className="dh-publish__label">Deck</span>
              <UntitledMenuSelect
                icon="ri-stack-line"
                value={listingProjectId ?? ""}
                onChange={(value) => setMode({ kind: "listing", projectId: value, picking: true })}
                aria-label="Deck to publish"
                options={pickerOptions}
              />
            </div>
          ) : null}
          {listingProjectId ? (
            <PublishForm
              key={listingProjectId}
              projectId={listingProjectId}
              deckName={listingDeck?.name ?? listingPublication?.title ?? "Deck"}
              cardCount={listingDeck?.total ?? listingPublication?.card_count ?? 0}
              publication={listingPublication}
              onPublicationChange={(next) => onListingChange(listingProjectId, next)}
              onCancel={() => setMode({ kind: "browse" })}
            />
          ) : (
            <div className="dh-bench-panel__empty">
              {ownDecks === undefined ? (
                <span>Loading your decks…</span>
              ) : (
                <>
                  <span>Decks you made, with at least one card, can be published.</span>
                  <Link href="/create" className="btn btn-secondary btn-sm">
                    Make a deck
                  </Link>
                </>
              )}
            </div>
          )}
        </aside>
      ) : focused ? (
        <CommunityPreviewPanel
          deck={focused}
          cards={detail?.previewCards}
          facts={detail?.facts}
          failed={Boolean(detailError) && !detail}
          busy={busyId === focused.id}
          ratingBusy={ratingBusyId === focused.id}
          error={error}
          onAdd={(syncMode) => void addDeck(focused, syncMode)}
          onStopFollowing={() => stopFollowing(focused)}
          onRate={(stars) => void rate(focused, stars)}
          onEditListing={() =>
            setMode({ kind: "listing", projectId: focused.source_project_id, picking: false })
          }
        />
      ) : (
        <aside className="dh-panel dh-panel--float dh-bench-panel" aria-label="Deck preview">
          <div className="dh-bench-panel__empty">
            <span>{decks.length === 0 ? "Community decks will show up here" : "Select a deck"}</span>
          </div>
        </aside>
      )}
    </div>
  );
}
