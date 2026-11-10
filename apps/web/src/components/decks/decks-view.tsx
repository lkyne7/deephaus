"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { DeckBulkPanel, mergeBlockedReason, mergeKeeper } from "@/components/decks/deck-bulk-panel";
import { DeckSummaryPanel, type DeckPanelHandlers } from "@/components/decks/deck-summary-panel";
import { DecksListSkeleton } from "@/components/decks/decks-skeleton";
import { FadeIn } from "@/components/motion/fade-in";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { UntitledMenuSelect } from "@/components/ui/untitled-controls";
import { BulkBar } from "@/components/workbench/bulk-bar";
import { ConfirmDialog } from "@/components/workbench/confirm-dialog";
import { handleListKeyDown, useSlashToSearch } from "@/components/workbench/list-keyboard";
import { ErrorToast } from "@/components/workbench/toast";
import { useListSelection } from "@/components/workbench/use-list-selection";
import { useBackgroundTasks } from "@/lib/background-tasks/context";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";
import { invalidateDeckCaches } from "@/lib/client-cache/prefetch";
import {
  DECK_OWNERSHIP_OPTIONS,
  DECK_SORT_OPTIONS,
  DECK_STATUS_OPTIONS,
  DEFAULT_DECK_SORT,
  cardCountLabel,
  deckStatus,
  nextDeckSort,
  reviewedLabel,
  toDeckRow,
  visibleDeckRows,
  type DeckListInput,
  type DeckListRow,
  type DeckOwnership,
  type DeckSort,
  type DeckSortKey,
  type DeckStatus,
} from "@/lib/decks/deck-list";
import {
  deleteProjectClient,
  mergeProjectsClient,
  setProjectPausedClient,
} from "@/lib/projects/delete-client";
import "@/components/workbench/workbench.css";
import "./decks.css";

const VIRTUAL_THRESHOLD = 100;
const ROW_HEIGHT = 65;

export function DecksView() {
  const { data: stats, error, mutate } = useDashboardStats();
  const searchParams = useSearchParams();
  const { startAnkiExport } = useBackgroundTasks();
  return (
    <DeckLibrary
      decks={stats?.per_deck}
      failed={Boolean(error)}
      onRetry={() => void mutate()}
      selectedId={searchParams.get("deck")}
      syncUrl
      onExport={(rows) => {
        // One export task per deck; each downloads its own file when ready.
        for (const row of rows) {
          if (row.total > 0) startAnkiExport(row.id, row.title);
        }
      }}
    />
  );
}

type Props = {
  decks: DeckListInput[] | undefined;
  failed?: boolean;
  onRetry?: () => void;
  /** The deck to open the page on (`/decks?deck=`). */
  selectedId?: string | null;
  /** Keep `?deck=` in step with the selected deck. */
  syncUrl?: boolean;
  /** Off for fixtures with no account behind them: the panel then makes no requests. */
  live?: boolean;
  /** Export the selected decks to Anki; the button is left out without it. */
  onExport?: (rows: DeckListRow[]) => void;
};

/** The whole page below the data hook, so the launch benchmark can feed it fixtures. */
export function DeckLibrary({
  decks: decksProp,
  failed = false,
  onRetry,
  selectedId = null,
  syncUrl = false,
  live = true,
  onExport,
}: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DeckSort>(DEFAULT_DECK_SORT);
  const [ownership, setOwnership] = useState<DeckOwnership | "">("");
  const [status, setStatus] = useState<DeckStatus | "">("");
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({});
  const [pausedOverrides, setPausedOverrides] = useState<Record<string, boolean>>({});
  const [pendingDuplicates, setPendingDuplicates] = useState<DeckListInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [pauseBusyIds, setPauseBusyIds] = useState<Set<string>>(() => new Set());
  const [deleteAsk, setDeleteAsk] = useState<DeckListRow[] | null>(null);
  const [mergeAsk, setMergeAsk] = useState<{ rows: DeckListRow[]; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mergeNameRef = useRef<HTMLInputElement>(null);
  const appliedSelection = useRef<string | null>(null);

  useSlashToSearch(searchRef);

  const rows = useMemo(() => {
    const fromStats = (decksProp ?? [])
      .filter((deck) => !removedIds.has(deck.deck_id))
      .map((deck) => ({
        ...deck,
        name: titleOverrides[deck.deck_id] ?? deck.name,
        paused: pausedOverrides[deck.deck_id] ?? deck.paused,
      }));
    const known = new Set(fromStats.map((deck) => deck.deck_id));
    const extras = pendingDuplicates.filter(
      (deck) => !known.has(deck.deck_id) && !removedIds.has(deck.deck_id),
    );
    return [...extras, ...fromStats].map(toDeckRow);
  }, [decksProp, removedIds, titleOverrides, pausedOverrides, pendingDuplicates]);

  const visible = useMemo(
    () => visibleDeckRows(rows, query, sort, { ownership, status }),
    [rows, query, sort, ownership, status],
  );

  const {
    focusedId,
    setFocusedId,
    focused,
    checkedIds,
    checkedItems,
    actionTargets,
    handleRowClick,
    toggleChecked,
    toggleFocused,
    selectAll,
    clearSelection,
    focusOnly,
    moveFocus,
  } = useListSelection(visible);
  // Rows that left the list (deleted, filtered out) no longer count as selected.
  const bulk = checkedItems.length > 1;

  // Drop pending rows once the stats payload includes them.
  useEffect(() => {
    setPendingDuplicates((prev) => {
      if (prev.length === 0 || !decksProp) return prev;
      const ids = new Set(decksProp.map((deck) => deck.deck_id));
      const next = prev.filter((deck) => !ids.has(deck.deck_id));
      return next.length === prev.length ? prev : next;
    });
  }, [decksProp]);

  // Open on the deck named in the URL, once the decks have loaded. A deck that
  // isn't there (deleted, or filtered out) is dropped rather than waited for.
  const loaded = decksProp !== undefined;
  useEffect(() => {
    if (!selectedId || !loaded || appliedSelection.current === selectedId) return;
    focusOnly(selectedId);
    appliedSelection.current = selectedId;
  }, [selectedId, loaded, focusOnly]);

  // Keep `?deck=` on the focused deck. Marking it applied first stops the
  // effect above from treating our own URL change as a new request, which
  // would collapse a multi-selection down to one deck.
  useEffect(() => {
    if (!syncUrl || !focusedId) return;
    if (selectedId && appliedSelection.current !== selectedId) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("deck") === focusedId) return;
    appliedSelection.current = focusedId;
    url.searchParams.set("deck", focusedId);
    window.history.replaceState(window.history.state, "", url);
  }, [syncUrl, focusedId, selectedId]);

  const virtual = visible.length > VIRTUAL_THRESHOLD;
  const focusedIndex = visible.findIndex((row) => row.id === focusedId);
  const virtualizer = useVirtualizer({
    count: visible.length,
    enabled: virtual,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => visible[index]!.id,
    overscan: 6,
    // Keep the focused row mounted if the user scrolls away from it.
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), ...(focusedIndex >= 0 ? [focusedIndex] : [])])].sort(
        (a, b) => a - b,
      ),
  });

  useEffect(() => {
    if (focusedIndex < 0) return;
    if (virtual) {
      virtualizer.scrollToIndex(focusedIndex);
      return;
    }
    listRef.current
      ?.querySelector<HTMLElement>(`[data-deck-id="${focusedId}"]`)
      ?.scrollIntoView({ block: "nearest" });
    // The virtualizer is stable enough; re-running on every instance change would fight scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId, focusedIndex, virtual]);

  const handlers: DeckPanelHandlers = useMemo(
    () => ({
      onDeleted(deckId) {
        setRemovedIds((prev) => new Set(prev).add(deckId));
        setPendingDuplicates((prev) => prev.filter((deck) => deck.deck_id !== deckId));
      },
      onRenamed(deckId, name) {
        setTitleOverrides((prev) => ({ ...prev, [deckId]: name }));
        setPendingDuplicates((prev) =>
          prev.map((deck) => (deck.deck_id === deckId ? { ...deck, name } : deck)),
        );
        invalidateDeckCaches();
      },
      onDuplicated(copy) {
        const total = copy.cardCount ?? 0;
        setPendingDuplicates((prev) => {
          if (prev.some((deck) => deck.deck_id === copy.id)) return prev;
          return [
            {
              deck_id: copy.id,
              name: copy.name,
              due: 0,
              new: total,
              last_reviewed: null,
              total,
              new_card_count: total,
            },
            ...prev,
          ];
        });
      },
      onPausedChange(deckId, paused) {
        void setPaused([deckId], paused);
      },
    }),
    // setPaused only closes over state setters, so the first one is as good as any.
    [],
  );

  async function setPaused(ids: string[], paused: boolean) {
    setError(null);
    setPauseBusyIds((prev) => new Set([...prev, ...ids]));
    setPausedOverrides((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, paused])) }));
    const failedIds: string[] = [];
    for (const id of ids) {
      try {
        await setProjectPausedClient(id, paused);
      } catch (err) {
        failedIds.push(id);
        setError(err instanceof Error ? err.message : "Could not update the deck.");
      }
    }
    if (failedIds.length > 0) {
      setPausedOverrides((prev) => ({
        ...prev,
        ...Object.fromEntries(failedIds.map((id) => [id, !paused])),
      }));
    }
    setPauseBusyIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    invalidateDeckCaches();
  }

  async function deleteDecks(targets: DeckListRow[]) {
    setBusy(true);
    setError(null);
    try {
      for (const row of targets) {
        await deleteProjectClient(row.id);
        handlers.onDeleted(row.id);
      }
      setDeleteAsk(null);
      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete deck.");
    } finally {
      setBusy(false);
      invalidateDeckCaches();
      listRef.current?.focus({ preventScroll: true });
    }
  }

  async function mergeDecks(targets: DeckListRow[], name: string) {
    const keeper = mergeKeeper(targets);
    if (!keeper) return;
    const others = targets.filter((row) => row.id !== keeper.id);
    setBusy(true);
    setError(null);
    try {
      await mergeProjectsClient({ keepId: keeper.id, otherIds: others.map((row) => row.id), name });
      setRemovedIds((prev) => new Set([...prev, ...others.map((row) => row.id)]));
      setTitleOverrides((prev) => ({ ...prev, [keeper.id]: name }));
      setMergeAsk(null);
      focusOnly(keeper.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not merge decks.");
    } finally {
      setBusy(false);
      invalidateDeckCaches();
    }
  }

  function studyTogether(targets: DeckListRow[]) {
    router.push(`/review?decks=${targets.map((row) => row.id).join(",")}`);
  }

  function clearFilters() {
    setQuery("");
    setOwnership("");
    setStatus("");
  }

  function onListKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    handleListKeyDown(e, {
      moveFocus,
      toggleFocused,
      selectAll,
      clearSelection,
      homeEnd: true,
      onOpen: () => {
        if (focused) router.push(`/decks/${focused.id}`);
      },
      onDelete: () => {
        if (actionTargets.length > 0) setDeleteAsk(actionTargets);
      },
    });
  }

  const onRowClick = useCallback(
    (row: DeckListRow, index: number, event: ReactMouseEvent) => handleRowClick(row, index, event),
    [handleRowClick],
  );
  const onRowToggle = useCallback(
    (row: DeckListRow, index: number) => {
      toggleChecked(row.id, index);
      setFocusedId(row.id);
    },
    [toggleChecked, setFocusedId],
  );
  const onRowOpen = useCallback((row: DeckListRow) => router.push(`/decks/${row.id}`), [router]);

  const hasFilters = Boolean(query.trim() || ownership || status);
  const dueTotal = visible.reduce((sum, row) => sum + (row.paused ? 0 : row.dueCount), 0);
  const allPaused = checkedItems.length > 0 && checkedItems.every((row) => row.paused);
  const mergeBlocked = mergeBlockedReason(checkedItems);

  function renderRow(row: DeckListRow, index: number) {
    return (
      <DeckRow
        row={row}
        index={index}
        setSize={visible.length}
        focused={row.id === focusedId}
        checked={checkedIds.has(row.id)}
        onClick={onRowClick}
        onToggle={onRowToggle}
        onOpen={onRowOpen}
      />
    );
  }

  return (
    <div className="dh-bench dhk">
      <div className="dh-bench-main">
        <div className="dh-bench-top">
          <div className="dh-bench-head">
            <h1 className="dh-title">Decks</h1>
            <Link href="/create" className="btn btn-secondary">
              <i className="ri-add-line" aria-hidden />
              New deck
            </Link>
          </div>
          <label className="untitled-search dh-bench-search">
            <i className="ri-search-line" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              className="untitled-search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={rows.length > 0 ? `Search ${cardlessCount(rows.length)}…` : "Search decks…"}
              aria-label="Search decks"
            />
            <kbd className="dh-kbd">/</kbd>
          </label>
          <div className="dh-bench-filters">
            <div className="dh-bench-filter" data-active={ownership ? "" : undefined}>
              <UntitledMenuSelect
                icon="ri-folder-3-line"
                value={ownership}
                onChange={(value) => setOwnership(value as DeckOwnership | "")}
                aria-label="Which decks"
                menuWidth={220}
                options={DECK_OWNERSHIP_OPTIONS}
              />
            </div>
            <div className="dh-bench-filter" data-active={status ? "" : undefined}>
              <UntitledMenuSelect
                value={status}
                onChange={(value) => setStatus(value as DeckStatus | "")}
                aria-label="Status"
                menuWidth={200}
                options={DECK_STATUS_OPTIONS}
              />
            </div>
            <div
              className="dh-bench-filter"
              data-active={sort.key !== DEFAULT_DECK_SORT.key ? "" : undefined}
            >
              <UntitledMenuSelect
                icon="ri-arrow-up-down-line"
                value={sort.key}
                onChange={(key) => setSort((current) => nextDeckSort(current, key as DeckSortKey))}
                aria-label="Sort decks"
                menuWidth={200}
                options={DECK_SORT_OPTIONS}
              />
            </div>
            {hasFilters ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
                Clear filters
              </button>
            ) : null}
            <span className="dh-spacer" />
            {decksProp ? (
              <span className="dh-bench-count">
                {cardlessCount(visible.length)}
                {dueTotal > 0 ? ` · ${dueTotal.toLocaleString()} due` : ""}
              </span>
            ) : null}
          </div>
        </div>

        <div
          ref={listRef}
          className={`dh-bench-list dhk-list${virtual ? " dhk-list--virtual" : ""}`}
          data-selecting={bulk ? "" : undefined}
          tabIndex={0}
          role="list"
          aria-label="Decks"
          onKeyDown={onListKeyDown}
          title="↑↓ move · Enter open · Space select · ⌘A select all · Del delete"
        >
          {!decksProp ? (
            failed ? (
              <LoadErrorState label="your decks" onRetry={onRetry} />
            ) : (
              <DecksListSkeleton />
            )
          ) : rows.length === 0 ? (
            <FadeIn>
              <div className="dh-empty">
                <h2>You haven&apos;t created any decks</h2>
                <p>Paste any resource and let DeepHaus turn it into flashcards.</p>
                <Link href="/create" className="btn btn-primary">
                  <i className="ri-add-line" aria-hidden />
                  New deck
                </Link>
              </div>
            </FadeIn>
          ) : visible.length === 0 ? (
            <FadeIn>
              <div className="dh-empty">
                <h2>No decks match your filters</h2>
                <p>Try a different search, or clear the filters.</p>
                <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
                  Clear filters
                </button>
              </div>
            </FadeIn>
          ) : virtual ? (
            <div role="presentation" style={{ position: "relative", height: virtualizer.getTotalSize() }}>
              {virtualizer.getVirtualItems().map((item) => (
                <div
                  key={item.key}
                  role="presentation"
                  data-index={item.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    paddingBottom: 1,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  {renderRow(visible[item.index]!, item.index)}
                </div>
              ))}
            </div>
          ) : (
            visible.map((row, index) => <Fragment key={row.id}>{renderRow(row, index)}</Fragment>)
          )}
        </div>

        {bulk ? (
          <BulkBar
            count={checkedItems.length}
            label="Selected decks"
            onClear={() => {
              clearSelection();
              listRef.current?.focus({ preventScroll: true });
            }}
          >
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => studyTogether(checkedItems)}>
              Study together
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={Boolean(mergeBlocked)}
              title={mergeBlocked ?? undefined}
              onClick={() => mergeNameRef.current?.focus()}
            >
              Merge
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => void setPaused(checkedItems.map((row) => row.id), !allPaused)}
            >
              {allPaused ? "Resume" : "Pause"}
            </button>
            {onExport ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onExport(checkedItems)}>
                Export
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost btn-sm dh-bench-danger"
              disabled={busy}
              onClick={() => setDeleteAsk(checkedItems)}
            >
              Delete
            </button>
          </BulkBar>
        ) : null}
      </div>

      {bulk ? (
        <DeckBulkPanel
          rows={checkedItems}
          busy={busy}
          nameInputRef={mergeNameRef}
          onClear={clearSelection}
          onMerge={(name) => setMergeAsk({ rows: checkedItems, name })}
        />
      ) : focused ? (
        <DeckSummaryPanel
          row={focused}
          live={live}
          pauseBusy={pauseBusyIds.has(focused.id)}
          handlers={handlers}
        />
      ) : (
        <aside className="dh-panel dh-panel--float dh-bench-panel" aria-label="Deck summary">
          <div className="dh-bench-panel__empty">
            <span>{decksProp && rows.length === 0 ? "Your decks will show up here" : "Select a deck"}</span>
          </div>
        </aside>
      )}

      <ConfirmDialog
        open={deleteAsk !== null}
        title={deleteAsk && deleteAsk.length > 1 ? `Delete ${deleteAsk.length} decks?` : "Delete this deck?"}
        confirmLabel={deleteAsk && deleteAsk.length > 1 ? `Delete ${deleteAsk.length} decks` : "Delete deck"}
        danger
        busy={busy}
        error={deleteAsk ? error : null}
        onCancel={() => setDeleteAsk(null)}
        onConfirm={() => deleteAsk && void deleteDecks(deleteAsk)}
      >
        {deleteAsk && deleteAsk.length === 1 ? (
          <>
            This permanently removes <strong>{deleteAsk[0]!.title}</strong>, its cards, sources and
            study history. This can&apos;t be undone.
          </>
        ) : (
          <>
            This permanently removes {deleteAsk?.length} decks, with their cards, sources and study
            history. This can&apos;t be undone.
          </>
        )}
        {deleteAsk?.some((row) => row.isPublished) ? (
          <> Published decks also lose their Community listing.</>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={mergeAsk !== null}
        title={`Merge ${mergeAsk?.rows.length ?? 0} decks?`}
        confirmLabel="Merge decks"
        busy={busy}
        error={mergeAsk ? error : null}
        onCancel={() => setMergeAsk(null)}
        onConfirm={() => mergeAsk && void mergeDecks(mergeAsk.rows, mergeAsk.name)}
      >
        Everything moves into one deck named <strong>{mergeAsk?.name}</strong>, and the other{" "}
        {mergeAsk && mergeAsk.rows.length > 2 ? `${mergeAsk.rows.length - 1} decks are` : "deck is"}{" "}
        removed. Cards and review history are kept. The merged deck uses the study settings of{" "}
        <strong>{mergeAsk ? mergeKeeper(mergeAsk.rows)?.title : ""}</strong>. This can&apos;t be undone.
      </ConfirmDialog>

      <ErrorToast message={deleteAsk || mergeAsk ? null : error} onDismiss={() => setError(null)} />
    </div>
  );
}

function cardlessCount(count: number) {
  return `${count.toLocaleString()} ${count === 1 ? "deck" : "decks"}`;
}

const STATUS_LABEL: Record<Exclude<DeckStatus, "study">, string> = {
  "caught-up": "Caught up",
  empty: "No cards yet",
  paused: "Paused",
};

const DeckRow = memo(function DeckRow({
  row,
  index,
  setSize,
  focused,
  checked,
  onClick,
  onToggle,
  onOpen,
}: {
  row: DeckListRow;
  index: number;
  setSize: number;
  focused: boolean;
  checked: boolean;
  onClick: (row: DeckListRow, index: number, event: ReactMouseEvent) => void;
  onToggle: (row: DeckListRow, index: number) => void;
  onOpen: (row: DeckListRow) => void;
}) {
  const state = deckStatus(row);
  const seen = Math.round(row.progress * 100);
  const origin = row.isCommunity ? "From Community" : row.isPublished ? "Published" : null;
  const className = [
    "dh-bench-row",
    "dhk-row",
    focused ? "is-focused" : "",
    checked ? "is-selected" : "",
    state === "empty" || state === "paused" ? "is-off" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      role="listitem"
      aria-setsize={setSize}
      aria-posinset={index + 1}
      aria-current={focused ? "true" : undefined}
      data-deck-id={row.id}
      className={className}
      onClick={(e) => onClick(row, index, e)}
      onDoubleClick={() => onOpen(row)}
      onMouseDown={(e) => {
        // Shift-click extends the selection; don't let it select page text too.
        if (e.shiftKey) e.preventDefault();
      }}
    >
      <span
        className="dh-bench-row__check"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(row, index);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={checked}
          aria-label={`Select ${row.title}`}
          onChange={() => onToggle(row, index)}
          onClick={(e) => e.stopPropagation()}
        />
      </span>
      <div className="dh-bench-row__body">
        <div className="dhk-row__title" title={row.title}>
          {row.title}
        </div>
        <div className="dhk-row__meta">
          {[cardCountLabel(row.total), reviewedLabel(row.lastReviewedRaw), origin].filter(Boolean).join(" · ")}
        </div>
      </div>
      {state === "study" ? (
        <span className="dhk-row__counts">
          <span className="dh-count dh-count--due" data-zero={row.dueCount === 0 ? "" : undefined}>
            {row.dueCount.toLocaleString()} due
          </span>
          <span className="dh-count dh-count--new" data-zero={row.newCount === 0 ? "" : undefined}>
            {row.newCount.toLocaleString()} new
          </span>
        </span>
      ) : (
        <span className="dhk-row__status">{STATUS_LABEL[state]}</span>
      )}
      <span className="dhk-row__meter" role="img" aria-label={`${seen}% of cards seen`} title={`${seen}% of cards seen`}>
        <span style={{ width: `${seen}%` }} />
      </span>
      <span className="dhk-row__action" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {state === "empty" ? (
          <Link
            href={`/create?deck=${row.id}`}
            className="dh-bench-iconbtn"
            aria-label={`Add cards to ${row.title}`}
            title="Add cards"
          >
            <i className="ri-add-line" aria-hidden />
          </Link>
        ) : state === "study" ? (
          <Link
            href={`/decks/${row.id}/study`}
            className="dh-bench-iconbtn"
            aria-label={`Study ${row.title}`}
            title="Study"
          >
            <i className="ri-play-fill" aria-hidden />
          </Link>
        ) : null}
      </span>
    </div>
  );
});
