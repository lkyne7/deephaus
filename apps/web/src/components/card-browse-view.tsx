"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api/fetch";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  type BrowseCardRow,
  type BrowseCardState,
  type BrowseFilters,
  cardAnswerText,
  cardPreviewText,
} from "@/lib/browse/cards";
import { CardFieldEditor } from "@/components/card-field-editor";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
import { cardTypeLabel, type CardType, type ImageOcclusionData } from "@deephaus/shared";
import { CardSaveStatus } from "@/components/card-save-status";
import {
  CardStudyPreviewLauncher,
  type CardStudyPreviewCard,
} from "@/components/card-study-preview";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { UntitledMenuSelect } from "@/components/ui/untitled-controls";
import { CardTagsEditor, parseTagsInput } from "@/components/card-tags-editor";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { buildCardUpdateBody, cardUpdateSnapshot, updateCardApi } from "@/lib/cards/update";
import { CardsListSkeleton } from "@/components/browse/cards-skeleton";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { BulkBar } from "@/components/workbench/bulk-bar";
import { handleListKeyDown, useSlashToSearch } from "@/components/workbench/list-keyboard";
import { useListSelection } from "@/components/workbench/use-list-selection";
import "@/components/workbench/workbench.css";
import "@/components/browse/cards.css";

type DeckOption = { id: string; name: string };

type Props = {
  initialDecks: DeckOption[];
};

const PAGE_SIZE = 50;

export function CardBrowseView({ initialDecks }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Defensive: dedupe by id so the deck <option> keys can never collide, even if
  // the source cache ever yields a duplicate row.
  const [decks] = useState(() => {
    const seen = new Set<string>();
    return initialDecks.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
  });
  const [tags, setTags] = useState<string[]>([]);
  const deckFromUrl = searchParams.get("deck") ?? "";
  const qFromUrl = searchParams.get("q") ?? "";
  const [deckId, setDeckId] = useState<string>(() =>
    deckFromUrl && initialDecks.some((d) => d.id === deckFromUrl) ? deckFromUrl : "",
  );
  const [tag, setTag] = useState<string>("");
  const [cardState, setCardState] = useState<BrowseCardState | "">("");
  const [search, setSearch] = useState(() => qFromUrl);
  const [debouncedSearch, setDebouncedSearch] = useState(() => qFromUrl.trim());
  const [cards, setCards] = useState<BrowseCardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    focusedId,
    setFocusedId,
    focused,
    checkedIds,
    actionTargets,
    bulk,
    handleRowClick,
    toggleChecked: toggleRowChecked,
    toggleFocused,
    selectAll: selectAllOnPage,
    clearSelection,
    moveFocus,
  } = useListSelection(cards);
  const [draft, setDraft] = useState<Partial<BrowseCardRow>>({});
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const cardsLengthRef = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (deckFromUrl && decks.some((d) => d.id === deckFromUrl)) {
      setDeckId(deckFromUrl);
    }
  }, [deckFromUrl, decks]);

  useEffect(() => {
    setSearch(qFromUrl);
  }, [qFromUrl]);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  useSlashToSearch(searchRef);

  useEffect(() => {
    setCards([]);
    setTotal(0);
    clearSelection();
  }, [deckId, tag, cardState, debouncedSearch, clearSelection]);

  useEffect(() => {
    cardsLengthRef.current = cards.length;
  }, [cards.length]);

  const loadCards = useCallback(async (append = false) => {
    if (append) {
      if (loadingMoreRef.current) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(append ? cardsLengthRef.current : 0),
      });
      if (deckId) params.set("deck_id", deckId);
      if (tag) params.set("tag", tag);
      if (cardState) params.set("state", cardState);
      if (debouncedSearch) params.set("q", debouncedSearch);

      const res = await apiFetch(`/api/browse/cards?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        cards: BrowseCardRow[];
        total: number;
      };
      // Defensive: guarantee unique card ids so React row keys never collide,
      // even if a future query/join or a stale response yields a duplicate row.
      const seen = new Set<string>();
      const uniqueCards = data.cards.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      if (append) {
        setCards((prev) => {
          const existing = new Set(prev.map((c) => c.id));
          return [...prev, ...uniqueCards.filter((c) => !existing.has(c.id))];
        });
      } else {
        setCards(uniqueCards);
      }
      setTotal(data.total);
    } catch (e) {
      if (!append) {
        setError(e instanceof Error ? e.message : "Failed to load cards");
      }
    } finally {
      if (append) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [deckId, tag, cardState, debouncedSearch]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  // Tag list is deck-scoped, so it only needs to refresh when the deck changes —
  // not on every keystroke or page, which is what made browse feel sluggish.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams();
        if (deckId) params.set("deck_id", deckId);
        const res = await apiFetch(`/api/browse/filters?${params}`, { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { filters: BrowseFilters | null };
        if (!cancelled && data.filters) setTags(data.filters.tags);
      } catch {
        // Non-fatal: the cards list still works without the tag filter list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  useEffect(() => {
    if (tag && !tags.includes(tag)) setTag("");
  }, [tag, tags]);

  const draftFocusIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focusedId) {
      draftFocusIdRef.current = null;
      setDraft({});
      setTagsInput("");
      return;
    }
    const card = cards.find((c) => c.id === focusedId);
    if (!card) return;
    if (draftFocusIdRef.current === focusedId) return;
    draftFocusIdRef.current = focusedId;
    setDraft({
      ...card,
      back: card.type === "basic" ? card.back ?? card.extra : card.back,
      extra: card.type === "basic" ? null : card.extra,
    });
    setTagsInput(card.tags.join(", "));
  }, [focusedId, cards]);

  useEffect(() => {
    if (!focusedId) return;
    rowRefs.current.get(focusedId)?.scrollIntoView({ block: "nearest" });
  }, [focusedId]);

  const hasMore = cards.length < total;
  const loadedCount = Math.min(cards.length, total);
  const hasActiveFilters = Boolean(deckId || tag || cardState || debouncedSearch);

  useEffect(() => {
    const root = listRef.current;
    const target = loadMoreRef.current;
    if (!root || !target || !hasMore || loading || loadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadCards(true);
        }
      },
      { root, rootMargin: "240px", threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, loadCards, cards.length]);

  useEffect(() => {
    if (!focusedId || !hasMore || loading || loadingMore) return;
    const idx = cards.findIndex((c) => c.id === focusedId);
    if (idx >= cards.length - 5) {
      void loadCards(true);
    }
  }, [focusedId, cards, hasMore, loading, loadingMore, loadCards]);

  const clearFilters = useCallback(() => {
    setDeckId("");
    setTag("");
    setCardState("");
    setSearch("");
    router.replace("/cards");
  }, [router]);
  const allLoadedChecked = cards.length > 0 && cards.every((c) => checkedIds.has(c.id));

  const setRowRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  async function runBatch(
    action: "suspend" | "unsuspend" | "delete",
    targets: BrowseCardRow[] = actionTargets,
  ) {
    const ids = targets.map((c) => c.id);
    if (ids.length === 0) return;

    if (action === "delete") {
      const noun = ids.length === 1 ? "this card" : `${ids.length} cards`;
      if (!confirm(`Delete ${noun}? This cannot be undone.`)) return;
    }

    setBatchBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/browse/batch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, card_ids: ids }),
      });
      if (!res.ok) throw new Error(await res.text());
      clearSelection();
      await loadCards();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch action failed");
    } finally {
      setBatchBusy(false);
      // The bulk bar unmounts with the selection; keep the shortcuts live.
      listRef.current?.focus({ preventScroll: true });
    }
  }

  async function toggleSuspendForTargets() {
    if (actionTargets.length === 0) return;
    const allSuspended = actionTargets.every((c) => c.suspended);
    await runBatch(allSuspended ? "unsuspend" : "suspend");
  }

  const parsedTags = useMemo(() => parseTagsInput(tagsInput), [tagsInput]);

  const previewCard = useMemo((): CardStudyPreviewCard | null => {
    if (!focused) return null;
    const type = (draft.type ?? focused.type) as CardStudyPreviewCard["type"];
    return {
      type,
      front: type === "cloze" ? null : (draft.front ?? focused.front ?? null),
      back: type === "basic" ? (draft.back ?? focused.back ?? null) : (draft.back ?? focused.back ?? null),
      cloze_text: type === "cloze" ? (draft.cloze_text ?? focused.cloze_text ?? null) : null,
      extra: type === "basic" ? null : (draft.extra ?? focused.extra ?? null),
      occlusion_data:
        type === "image-occlusion"
          ? ((draft.occlusion_data as ImageOcclusionData | undefined) ??
            focused.occlusion_data ??
            null)
          : undefined,
      tags: parsedTags,
    };
  }, [focused, draft, parsedTags]);

  const saveSnapshot = useMemo(() => {
    if (!focused) return "";
    const cardType = (draft.type ?? focused.type) as "basic" | "cloze" | "image-occlusion";
    return cardUpdateSnapshot({
      type: cardType,
      front: draft.front ?? focused.front,
      back: draft.back ?? focused.back,
      cloze_text: draft.cloze_text ?? focused.cloze_text,
      extra: draft.extra ?? focused.extra,
      occlusion_data:
        (draft.occlusion_data as ImageOcclusionData | undefined) ??
        (focused.occlusion_data as ImageOcclusionData | undefined) ??
        null,
      tags: parsedTags,
    });
  }, [focused, draft, parsedTags]);

  const persistFocusedCard = useCallback(async (isCurrent:()=>boolean=()=>true) => {
    if (!focused) return;
    const cardType = (draft.type ?? focused.type) as "basic" | "cloze" | "image-occlusion";
    const body = buildCardUpdateBody({
      type: cardType,
      front: draft.front ?? focused.front,
      back: draft.back ?? focused.back,
      cloze_text: draft.cloze_text ?? focused.cloze_text,
      extra: draft.extra ?? focused.extra,
      occlusion_data:
        (draft.occlusion_data as ImageOcclusionData | undefined) ??
        (focused.occlusion_data as ImageOcclusionData | undefined) ??
        null,
      tags: parsedTags,
    });
    const saved = await updateCardApi<BrowseCardRow>(focused.id, body);
    if(!isCurrent()) return;
    setCards((prev) =>
      prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)),
    );
  }, [focused, draft, parsedTags]);

  const { status: saveStatus, error: saveError, flush } = useAutoSaveCard({
    cardId: focused?.id ?? null,
    snapshot: saveSnapshot,
    // Only auto-save once the draft belongs to the focused card. On a card switch
    // the focused id updates one render before the draft does; gating here avoids
    // saving a stale/mismatched snapshot back to the newly focused card.
    enabled:
      Boolean(focused) &&
      draft.id === focusedId &&
      checkedIds.size <= 1 &&
      !batchBusy,
    onRestore: (value) => { const restored = JSON.parse(value); setDraft(previous=>({...previous,...restored})); setTagsInput((restored.tags ?? []).join(", ")); },
    save: persistFocusedCard,
  });

  async function toggleSuspendSingle(next: boolean) {
    if (!focused) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/cards/${focused.id}/suspend`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspended: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCards((prev) =>
        prev.map((c) => (c.id === focused.id ? { ...c, suspended: next } : c)),
      );
      setDraft((d) => ({ ...d, suspended: next }));
      if (cardState) await loadCards();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update suspend state");
    } finally {
      setSaving(false);
    }
  }

  function onListKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    handleListKeyDown(e, {
      moveFocus,
      toggleFocused,
      selectAll: selectAllOnPage,
      clearSelection,
      onDelete: () => void runBatch("delete"),
      extra: (event, mod) => {
        if (mod && event.key.toLowerCase() === "j") {
          event.preventDefault();
          void toggleSuspendForTargets();
          return true;
        }
        return false;
      },
    });
  }

  function clearBulkFromBar() {
    clearSelection();
    listRef.current?.focus({ preventScroll: true });
  }

  const editorCardType = (draft.type ?? focused?.type) as CardType | undefined;

  return (
    <div className="dh-bench dh-cards">
      <div className="dh-bench-main">
        <div className="dh-bench-top">
          <h1 className="dh-title dh-bench-title">Cards</h1>
          <label className="untitled-search dh-bench-search">
            <i className="ri-search-line" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              className="untitled-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                total > 0 && !hasActiveFilters
                  ? `Search ${total.toLocaleString()} cards…`
                  : "Search cards…"
              }
              aria-label="Search cards"
            />
            <kbd className="dh-kbd">/</kbd>
          </label>
          <div className="dh-bench-filters">
            <div className="dh-bench-filter" data-active={deckId ? "" : undefined}>
              <UntitledMenuSelect
                icon="ri-folder-3-line"
                value={deckId}
                onChange={setDeckId}
                aria-label="Deck"
                menuWidth={320}
                options={[
                  { value: "", label: "All decks", icon: "ri-folder-3-line" },
                  ...decks.map((d) => ({
                    value: d.id,
                    label: d.name,
                    icon: "ri-folder-3-line" as const,
                  })),
                ]}
              />
            </div>
            <div className="dh-bench-filter" data-active={tag ? "" : undefined}>
              <UntitledMenuSelect
                icon="ri-price-tag-3-line"
                value={tag}
                onChange={setTag}
                aria-label="Tag"
                disabled={tags.length === 0}
                menuWidth={320}
                options={[
                  { value: "", label: "All tags", icon: "ri-price-tag-3-line" },
                  ...tags.map((t) => ({
                    value: t,
                    label: t,
                    icon: "ri-price-tag-3-line" as const,
                  })),
                ]}
              />
            </div>
            <div className="dh-bench-filter" data-active={cardState ? "" : undefined}>
              <UntitledMenuSelect
                value={cardState}
                onChange={(value) => setCardState(value as BrowseCardState | "")}
                aria-label="State"
                menuWidth={200}
                options={[
                  { value: "", label: "Any state" },
                  { value: "active", label: "Active" },
                  { value: "suspended", label: "Suspended" },
                ]}
              />
            </div>
            {hasActiveFilters ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={clearFilters}
                aria-label="Clear all filters"
              >
                Clear filters
              </button>
            ) : null}
            <span className="dh-spacer" />
            <span className="dh-bench-count">
              {loading && cards.length === 0 ? (
                <SkeletonBar width={64} height={12} />
              ) : total === 0 ? (
                "No cards"
              ) : (
                `${loadedCount.toLocaleString()} of ${total.toLocaleString()}`
              )}
            </span>
          </div>
          {error ? (
            <div className="dh-note dh-bench-error" role="alert">
              <i className="ri-error-warning-line" aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <div
          ref={listRef}
          className="dh-bench-list"
          data-selecting={bulk ? "" : undefined}
          tabIndex={0}
          onKeyDown={onListKeyDown}
          aria-label="Card list"
          title="↑↓ move · ⌘A select all · ⌘J suspend · Space toggle · Del delete"
        >
          {loading && cards.length === 0 ? (
            <CardsListSkeleton />
          ) : cards.length === 0 ? (
            error ? null : hasActiveFilters ? (
              <div className="dh-empty">
                <h2>No cards match your filters</h2>
                <p>Try a different search, or clear the filters.</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            ) : (
              <div className="dh-empty">
                <h2>You don&apos;t have any cards yet</h2>
                <p>Create a deck from your notes, a PDF, or a link to get started.</p>
                <Link href="/create" className="btn btn-primary btn-sm">
                  <i className="ri-add-line" aria-hidden />
                  Create cards
                </Link>
              </div>
            )
          ) : (
            <>
              {cards.map((card, index) => (
                <CardRow
                  key={card.id}
                  card={card}
                  focused={card.id === focusedId}
                  checked={checkedIds.has(card.id)}
                  rowRef={(el) => setRowRef(card.id, el)}
                  onClick={(e) => handleRowClick(card, index, e)}
                  onToggle={() => {
                    toggleRowChecked(card.id, index);
                    setFocusedId(card.id);
                  }}
                />
              ))}
              {hasMore ? (
                <div ref={loadMoreRef} className="dh-bench-more" aria-hidden>
                  {loadingMore ? (
                    <>
                      <i className="ri-loader-4-line icon-spin" /> Loading more…
                    </>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>

        {bulk ? (
          <BulkBar count={checkedIds.size} label="Selected cards" onClear={clearBulkFromBar}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={batchBusy}
              onClick={() => void runBatch("suspend")}
            >
              Suspend
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={batchBusy}
              onClick={() => void runBatch("unsuspend")}
            >
              Unsuspend
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm dh-bench-danger"
              disabled={batchBusy}
              onClick={() => void runBatch("delete")}
            >
              Delete
            </button>
          </BulkBar>
        ) : null}
      </div>

      <aside className="dh-panel dh-panel--float dh-bench-panel dh-cards-panel" aria-label="Card editor">
        {bulk ? (
          <div className="dh-bench-panel__empty">
            <span>{checkedIds.size} cards selected</span>
            {!allLoadedChecked ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllOnPage}>
                Select all {loadedCount.toLocaleString()}
              </button>
            ) : null}
          </div>
        ) : !focused || !editorCardType ? (
          <div className="dh-bench-panel__empty">
            <span>Select a card to edit</span>
          </div>
        ) : (
          <>
            <div className="dh-panel__head dh-bench-panel__head">
              <div className="dh-bench-panel__heading">
                <div className="dh-bench-panel__title">{focused.deck_name}</div>
                <div className="dh-bench-panel__sub">{cardTypeLabel(editorCardType, "short")}</div>
              </div>
              <span className="dh-spacer" />
              {previewCard ? (
                <CardStudyPreviewLauncher
                  key={focused.id}
                  card={previewCard}
                  disabled={batchBusy}
                  compact
                />
              ) : null}
              <CardMoreMenu
                disabled={batchBusy}
                onDelete={() => void runBatch("delete", [focused])}
              />
            </div>

            <div className="dh-panel__body dh-cards-panel__body">
              {editorCardType === "image-occlusion" ? (
                <ImageOcclusionCardSection
                  key={`${focused.id}-occlusion`}
                  cardId={focused.id}
                  front={draft.front ?? focused.front ?? ""}
                  back={draft.back ?? focused.back ?? ""}
                  occlusionData={draft.occlusion_data ?? focused.occlusion_data ?? null}
                  disabled={batchBusy}
                  onChange={(patch) =>
                    setDraft((d) => ({
                      ...d,
                      type: patch.type,
                      front: patch.front,
                      back: patch.back,
                      occlusion_data: patch.occlusion_data,
                      cloze_text: null,
                      extra: null,
                    }))
                  }
                />
              ) : (
                <>
                  <CardFieldEditor
                    key={`${focused.id}-front`}
                    label="Front"
                    cardId={focused.id}
                    allowCloze={editorCardType === "cloze"}
                    value={
                      editorCardType === "cloze"
                        ? (draft.cloze_text ?? focused.cloze_text ?? "")
                        : (draft.front ?? focused.front ?? "")
                    }
                    onChange={(v) =>
                      setDraft((d) =>
                        editorCardType === "cloze"
                          ? { ...d, cloze_text: v }
                          : { ...d, front: v },
                      )
                    }
                    placeholder={
                      editorCardType === "cloze"
                        ? "Cloze text: select text and use C or C1/C2/C3"
                        : "Question"
                    }
                    disabled={batchBusy}
                  />
                  <CardFieldEditor
                    key={`${focused.id}-back`}
                    label="Back"
                    cardId={focused.id}
                    value={
                      editorCardType === "cloze"
                        ? (draft.extra ?? focused.extra ?? "")
                        : (draft.back ?? draft.extra ?? focused.back ?? focused.extra ?? "")
                    }
                    onChange={(v) =>
                      setDraft((d) =>
                        editorCardType === "cloze"
                          ? { ...d, extra: v }
                          : { ...d, back: v, extra: null },
                      )
                    }
                    placeholder={editorCardType === "cloze" ? "Answer shown on reveal" : "Answer"}
                    disabled={batchBusy}
                  />
                </>
              )}

              <CardTagsEditor
                key={`${focused.id}-tags`}
                value={tagsInput}
                onChange={setTagsInput}
                disabled={batchBusy}
                variant="pills"
              />
            </div>

            <div className="dh-panel__foot dh-bench-panel__foot">
              <CardSaveStatus
                status={saveStatus === "idle" ? "saved" : saveStatus}
                error={saveError}
                onRetry={() => {
                  void flush().catch(() => undefined);
                }}
              />
              <span className="dh-spacer" />
              <SuspendToggle
                suspended={Boolean(draft.suspended ?? focused.suspended)}
                disabled={saving || batchBusy}
                onChange={(next) => void toggleSuspendSingle(next)}
              />
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function CardRow({
  card,
  focused,
  checked,
  rowRef,
  onClick,
  onToggle,
}: {
  card: BrowseCardRow;
  focused: boolean;
  checked: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
  onClick: (event: ReactMouseEvent) => void;
  onToggle: () => void;
}) {
  const question = cardPreviewText(card);
  const answer = cardAnswerText(card);
  const className = [
    "dh-bench-row",
    focused ? "is-focused" : "",
    checked ? "is-selected" : "",
    card.suspended ? "is-suspended" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={rowRef}
      className={className}
      onClick={onClick}
      onMouseDown={(e) => {
        // Shift-click extends the selection; don't let it select page text too.
        if (e.shiftKey) e.preventDefault();
      }}
    >
      <span
        className="dh-bench-row__check"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <input
          type="checkbox"
          checked={checked}
          aria-label={`Select ${question || "card"}`}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
        />
      </span>
      <div className="dh-bench-row__body">
        <div className="dh-cards-row__question">
          {!question ? (
            "No text"
          ) : card.type === "image-occlusion" ? (
            question
          ) : (
            <CardContentRenderer
              content={card.type === "cloze" ? card.cloze_text : card.front}
              clozeMode={card.type === "cloze" ? "revealed" : "none"}
            />
          )}
        </div>
        {answer ? (
          <div className="dh-cards-row__answer">
            <CardContentRenderer
              content={card.type === "basic" ? (card.back ?? card.extra) : card.extra}
            />
          </div>
        ) : null}
        <div className="dh-cards-row__meta">
          <span className="dh-cards-row__source">
            {[card.deck_name, card.tags.join(", ")].filter(Boolean).join(" · ")}
          </span>
          {card.suspended ? (
            <span className="dh-cards-row__state">
              <i className="ri-pause-circle-line" aria-hidden />
              Suspended
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CardMoreMenu({ disabled, onDelete }: { disabled?: boolean; onDelete: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="dh-bench-menu">
      <button
        type="button"
        className="dh-bench-iconbtn"
        aria-label="More card actions"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="ri-more-line" aria-hidden />
      </button>
      {open ? (
        <div className="dh-bench-menu__list" role="menu" aria-label="Card actions">
          <button
            type="button"
            role="menuitem"
            className="dh-menu-row dh-menu-row--danger"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <i className="ri-delete-bin-line" aria-hidden />
            Delete card
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SuspendToggle({
  suspended,
  disabled,
  onChange,
}: {
  suspended: boolean;
  disabled?: boolean;
  onChange: (suspended: boolean) => void;
}) {
  return (
    <span className="dh-bench-switch">
      <span className="dh-bench-switch__label">{suspended ? "Suspended" : "Active"}</span>
      <button
        type="button"
        role="switch"
        className="dh-toggle"
        aria-checked={!suspended}
        aria-label={suspended ? "Suspended, click to activate" : "Active, click to suspend"}
        disabled={disabled}
        onClick={() => onChange(!suspended)}
      />
    </span>
  );
}
