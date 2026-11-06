"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { DeckActionsMenu } from "@/components/deck-actions-menu";
import { DecksBodySkeleton } from "@/components/decks/decks-skeleton";
import { FadeIn } from "@/components/motion/fade-in";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { OptionMenu } from "@/components/ui/option-menu";
import { UntitledSearchInput } from "@/components/ui/untitled-controls";
import { VirtualDeckGrid } from "@/components/virtual-deck-grid";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";
import {
  DECK_SORT_OPTIONS,
  DEFAULT_DECK_SORT,
  cardCountLabel,
  defaultSortDir,
  nextDeckSort,
  reviewedLabel,
  toDeckRow,
  visibleDeckRows,
  type DeckListInput,
  type DeckListRow,
  type DeckSort,
  type DeckSortKey,
} from "@/lib/decks/deck-list";
import { useDeckViewMode } from "@/lib/ui/deck-view-mode";
import "./decks.css";

const VIRTUAL_THRESHOLD = 100;

type RowHandlers = {
  onDeleted: (deckId: string) => void;
  onRenamed: (deckId: string, name: string) => void;
  onDuplicated: (copy: { id: string; name: string; cardCount?: number }) => void;
};

export function DecksView() {
  const { data: stats, error, mutate } = useDashboardStats();
  return (
    <DeckLibrary decks={stats?.per_deck} failed={Boolean(error)} onRetry={() => void mutate()} />
  );
}

/** The whole page below the data hook, so the launch benchmark can feed it fixtures. */
export function DeckLibrary({
  decks: decksProp,
  failed = false,
  onRetry,
}: {
  decks: DeckListInput[] | undefined;
  failed?: boolean;
  onRetry?: () => void;
}) {
  const { viewMode, setViewMode } = useDeckViewMode();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DeckSort>(DEFAULT_DECK_SORT);
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({});
  const [pendingDuplicates, setPendingDuplicates] = useState<DeckListInput[]>([]);

  const rows = useMemo(() => {
    const fromStats = (decksProp ?? [])
      .filter((deck) => !removedIds.has(deck.deck_id))
      .map((deck) =>
        titleOverrides[deck.deck_id] ? { ...deck, name: titleOverrides[deck.deck_id]! } : deck,
      );
    const known = new Set(fromStats.map((deck) => deck.deck_id));
    const extras = pendingDuplicates.filter(
      (deck) => !known.has(deck.deck_id) && !removedIds.has(deck.deck_id),
    );
    return [...extras, ...fromStats].map(toDeckRow);
  }, [decksProp, removedIds, titleOverrides, pendingDuplicates]);

  const visible = useMemo(() => visibleDeckRows(rows, query, sort), [rows, query, sort]);

  // Drop pending rows once the stats payload includes them.
  useEffect(() => {
    setPendingDuplicates((prev) => {
      if (prev.length === 0 || !decksProp) return prev;
      const ids = new Set(decksProp.map((deck) => deck.deck_id));
      const next = prev.filter((deck) => !ids.has(deck.deck_id));
      return next.length === prev.length ? prev : next;
    });
  }, [decksProp]);

  const handlers: RowHandlers = {
    onDeleted(deckId) {
      setRemovedIds((prev) => new Set(prev).add(deckId));
      setPendingDuplicates((prev) => prev.filter((deck) => deck.deck_id !== deckId));
    },
    onRenamed(deckId, name) {
      setTitleOverrides((prev) => ({ ...prev, [deckId]: name }));
      setPendingDuplicates((prev) =>
        prev.map((deck) => (deck.deck_id === deckId ? { ...deck, name } : deck)),
      );
    },
    onDuplicated(copy) {
      const total = copy.cardCount ?? 0;
      setPendingDuplicates((prev) => {
        if (prev.some((deck) => deck.deck_id === copy.id)) return prev;
        if (decksProp?.some((deck) => deck.deck_id === copy.id)) return prev;
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
  };

  const showProgress = sort.key === "progress";

  return (
    <div className="dh-page dhk">
      <header className="dh-page-head">
        <h1 className="dh-title">Decks</h1>
        <span className="dh-spacer" />
        <Link href="/create" className="btn btn-primary">
          <i className="ri-add-line" aria-hidden />
          New deck
        </Link>
      </header>

      <div className="dh-toolbar">
        <UntitledSearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search decks…"
          aria-label="Search decks"
        />
        <OptionMenu<DeckSortKey>
          aria-label="Sort decks"
          prefix="Sort: "
          value={sort.key}
          options={DECK_SORT_OPTIONS}
          suffix={
            sort.dir === defaultSortDir(sort.key) ? null : (
              <i className="ri-arrow-up-down-line dhk-sort__flip" title="Reversed" aria-label="Reversed" />
            )
          }
          triggerClassName="btn btn-secondary dhk-sort"
          onChange={(key) => setSort((current) => nextDeckSort(current, key))}
        />
        <div className="dh-seg dhk-view" role="group" aria-label="Deck view">
          <ViewButton
            active={viewMode === "table"}
            icon="ri-list-unordered"
            label="List view"
            onClick={() => setViewMode("table")}
          />
          <ViewButton
            active={viewMode === "grid"}
            icon="ri-layout-grid-line"
            label="Card view"
            onClick={() => setViewMode("grid")}
          />
        </div>
      </div>

      {!decksProp ? (
        failed ? (
          <LoadErrorState label="your decks" onRetry={onRetry} />
        ) : (
          <DecksBodySkeleton view={viewMode} />
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
            <h2>No decks match “{query.trim()}”</h2>
          </div>
        </FadeIn>
      ) : viewMode === "grid" ? (
        <DeckCards rows={visible} handlers={handlers} showProgress={showProgress} />
      ) : (
        <DeckRows
          key={`${query}:${sort.key}:${sort.dir}`}
          rows={visible}
          handlers={handlers}
          showProgress={showProgress}
        />
      )}
    </div>
  );
}

function ViewButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} title={label} onClick={onClick}>
      <i className={icon} aria-hidden />
    </button>
  );
}

function metaLine(row: DeckListRow, showProgress: boolean) {
  const parts = [cardCountLabel(row.total), reviewedLabel(row.lastReviewedRaw)];
  if (showProgress) parts.push(`${Math.round(row.progress * 100)}% seen`);
  return parts.join(" · ");
}

function DeckTags({ row }: { row: DeckListRow }) {
  if (!row.isCommunity && !row.isPublished) return null;
  return (
    <span className="dhk-tags">
      {row.isCommunity ? (
        <span className="dh-pill dh-pill--outline" title="This deck follows a community publication">
          Subscribed
        </span>
      ) : null}
      {row.isPublished ? (
        <span className="dh-pill dh-pill--accent" title="You shared this deck to the community">
          Published
        </span>
      ) : null}
    </span>
  );
}

function RowActions({ row, handlers }: { row: DeckListRow; handlers: RowHandlers }) {
  return (
    <DeckActionsMenu
      deck={{
        id: row.id,
        title: row.title,
        cardCount: row.total,
        isPublished: row.isPublished,
        isCommunity: row.isCommunity,
      }}
      omit={["study"]}
      onRenamed={(name) => handlers.onRenamed(row.id, name)}
      onDeleted={handlers.onDeleted}
      onDuplicated={handlers.onDuplicated}
    />
  );
}

function StudyAction({ row, className }: { row: DeckListRow; className: string }) {
  if (row.total === 0) {
    return (
      <button type="button" className={className} disabled title="Add cards to study this deck">
        Study
      </button>
    );
  }
  return (
    <Link href={`/decks/${row.id}/study`} className={className} aria-label={`Study ${row.title}`}>
      Study
    </Link>
  );
}

function DeckCard({
  row,
  handlers,
  showProgress,
}: {
  row: DeckListRow;
  handlers: RowHandlers;
  showProgress: boolean;
}) {
  return (
    <article className="dhk-card">
      <h3 className="dhk-card__title">
        <Link href={`/decks/${row.id}`} className="dhk-link" data-deck-id={row.id} title={row.title}>
          {row.title}
        </Link>
      </h3>
      <div className="dhk-card__meta">{metaLine(row, showProgress)}</div>
      <DeckTags row={row} />
      <span className="dh-spacer" />
      <div className="dhk-card__foot">
        {row.dueCount > 0 ? (
          <span className="dh-count dh-count--due">{row.dueCount.toLocaleString()} due</span>
        ) : null}
        {row.newCount > 0 ? (
          <span className="dh-count dh-count--new">{row.newCount.toLocaleString()} new</span>
        ) : null}
        {row.dueCount === 0 && row.newCount === 0 ? <span>Nothing due</span> : null}
        <span className="dh-spacer" />
        <span className="dhk-card__actions">
          <RowActions row={row} handlers={handlers} />
          <StudyAction row={row} className="btn btn-primary btn-sm" />
        </span>
      </div>
    </article>
  );
}

function DeckCards({
  rows,
  handlers,
  showProgress,
}: {
  rows: DeckListRow[];
  handlers: RowHandlers;
  showProgress: boolean;
}) {
  const render = (row: DeckListRow) => (
    <DeckCard row={row} handlers={handlers} showProgress={showProgress} />
  );
  if (rows.length > VIRTUAL_THRESHOLD) {
    return (
      <VirtualDeckGrid ids={rows.map((row) => row.id)} renderDeck={(index) => render(rows[index]!)} />
    );
  }
  return (
    <FadeIn className="dhk-grid">
      {rows.map((row) => (
        <div key={row.id}>{render(row)}</div>
      ))}
    </FadeIn>
  );
}

function DeckRow({
  row,
  rule,
  handlers,
  showProgress,
}: {
  row: DeckListRow;
  rule: boolean;
  handlers: RowHandlers;
  showProgress: boolean;
}) {
  return (
    <div className={`dh-row dhk-row${rule ? " dhk-row--rule" : ""}`}>
      <div className="dhk-row__main">
        <Link href={`/decks/${row.id}`} className="dhk-link dhk-row__title" data-deck-id={row.id} title={row.title}>
          {row.title}
        </Link>
        <div className="dhk-row__meta">
          {metaLine(row, showProgress)}
          <DeckTags row={row} />
        </div>
      </div>
      <span className="dh-count dh-count--due dhk-row__count">{row.dueCount.toLocaleString()} due</span>
      <span className="dh-count dh-count--new dhk-row__count">{row.newCount.toLocaleString()} new</span>
      <span className="dhk-row__actions">
        <StudyAction row={row} className="btn btn-secondary btn-sm" />
        <RowActions row={row} handlers={handlers} />
      </span>
    </div>
  );
}

function DeckRows({
  rows,
  handlers,
  showProgress,
}: {
  rows: DeckListRow[];
  handlers: RowHandlers;
  showProgress: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusedDeck, setFocusedDeck] = useState<string | null>(null);
  const virtual = rows.length > VIRTUAL_THRESHOLD;
  const focusedIndex = rows.findIndex((row) => row.id === focusedDeck);
  const virtualizer = useVirtualizer({
    count: rows.length,
    enabled: virtual,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    getItemKey: (index) => rows[index]!.id,
    overscan: 6,
    // Keep keyboard focus mounted if the user scrolls away from that row.
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), ...(focusedIndex >= 0 ? [focusedIndex] : [])])].sort(
        (a, b) => a - b,
      ),
  });

  function focusRow(index: number) {
    const row = rows[index];
    if (!row) return;
    setFocusedDeck(row.id);
    if (virtual) virtualizer.scrollToIndex(index);
    requestAnimationFrame(() =>
      scrollRef.current?.querySelector<HTMLElement>(`[data-deck-id="${row.id}"]`)?.focus(),
    );
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const target = event.target as HTMLElement;
    const deckId = target.dataset.deckId;
    if (!deckId) return;
    const index = rows.findIndex((row) => row.id === deckId);
    const next =
      event.key === "ArrowDown"
        ? index + 1
        : event.key === "ArrowUp"
          ? index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? rows.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    focusRow(Math.max(0, Math.min(rows.length - 1, next)));
  }

  const onFocusCapture = (event: React.FocusEvent) => {
    const deckId = (event.target as HTMLElement).dataset.deckId;
    if (deckId) setFocusedDeck(deckId);
  };

  if (!virtual) {
    return (
      <div ref={scrollRef} className="dhk-rows" onKeyDown={onKeyDown} onFocusCapture={onFocusCapture}>
        {rows.map((row) => (
          <DeckRow key={row.id} row={row} rule={false} handlers={handlers} showProgress={showProgress} />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="dhk-rows dhk-rows--virtual"
      role="list"
      aria-label="Decks"
      onKeyDown={onKeyDown}
      onFocusCapture={onFocusCapture}
    >
      <div role="presentation" style={{ position: "relative", height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            role="listitem"
            aria-posinset={item.index + 1}
            aria-setsize={rows.length}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
          >
            <DeckRow
              row={rows[item.index]!}
              rule={item.index > 0}
              handlers={handlers}
              showProgress={showProgress}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
