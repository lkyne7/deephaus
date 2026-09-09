"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type RefObject,
} from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  CARD_EDITOR_TYPE_OPTIONS,
  cardTypeChipClass,
  cardTypeLabel,
  type CardType,
  type DraftCard,
} from "@deephaus/shared";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { CardListSkeleton } from "@/components/ui/skeleton-patterns";
import { cardPreviewText } from "@/lib/browse/cards";
import { supportsCardAiActions } from "@/lib/cards/mnemonic";
import type { CardAssistantPlacement } from "@/components/create/card-assistant-bar";
import { formatSegmentLabel } from "@/lib/sources/chunks";
import { motionTransition, motionTokens } from "@/lib/motion";

/**
 * Create page — right-hand cards pane.
 * ---------------------------------------------------------------------
 * Renders the deck's cards as selectable tiles with hover actions plus a
 * header that morphs into a selection toolbar. Selection state is owned by
 * the parent (`selectedIds` + `onSelectionChange`); this component handles
 * the interaction model (toggle, shift-range, keyboard navigation).
 */

const MAX_VISIBLE_TAGS = 3;

export type CardAiAction = "mnemonic" | "regenerate";

export type CreateCardsPaneProps = {
  cards: DraftCard[];
  totalCards: number;
  projectId: string | null;
  cardsLoading: boolean;
  cardsRefreshing: boolean;
  loadingMoreCards: boolean;
  hasMoreCards: boolean;
  /** Disables mutations while generation/saving is in flight. */
  busy: boolean;
  focusedId: string | null;
  overlayOpen: boolean;
  flashIds: Set<string>;
  /** Cards currently being rewritten by the assistant. */
  pulseIds: Set<string>;
  /** Per-card one-click AI rewrites in flight (mnemonic / regenerate). */
  actionBusy: ReadonlyMap<string, CardAiAction>;
  /** Card whose last one-click rewrite can still be undone, and which rewrite it was. */
  rewriteNotice: { id: string; action: CardAiAction } | null;
  selectedIds: Set<string>;
  assistantOpen: boolean;
  assistantPlacement?: CardAssistantPlacement;
  listScrollRef: RefObject<HTMLDivElement | null>;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  cardRowRefs: MutableRefObject<Map<string, HTMLElement>>;
  onSelectionChange: (next: Set<string>) => void;
  onOpenCard: (id: string) => void;
  onCreateCard: (type: CardType) => void;
  onDeleteCard: (id: string) => void;
  onDeleteSelected: () => void;
  /** Open the assistant scoped to one card, next to the trigger. */
  onAssistCard: (id: string, anchor: HTMLElement) => void;
  /** Rewrite one card as an AnKing-style mnemonic card (same type). */
  onGenerateMnemonic: (id: string) => void;
  /** Rewrite one card from its source in one click. */
  onRegenerateCard: (id: string) => void;
  onUndoRewrite: () => void;
  onDismissRewriteNotice: () => void;
  /** Open the assistant scoped to the current selection (or all cards), next to the trigger. */
  onOpenAssistant: (anchor: HTMLElement) => void;
};

/**
 * Back-side text for a tile. Like `cardAnswerText` but keeps line structure so
 * multi-line answers (e.g. mnemonic item lists) keep their lines in the tile.
 */
function tileAnswerText(card: Pick<DraftCard, "type" | "back" | "extra">): string {
  const raw = card.type === "basic" ? (card.back ?? card.extra ?? "") : (card.extra ?? "");
  return raw
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "[image]")
    .replace(/<img[^>]*>/gi, "[image]")
    .trim();
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("button, input, a, textarea, select, [role='menu']"));
}

export function CreateCardsPane({
  cards,
  totalCards,
  projectId,
  cardsLoading,
  cardsRefreshing,
  loadingMoreCards,
  hasMoreCards,
  busy,
  focusedId,
  overlayOpen,
  flashIds,
  pulseIds,
  actionBusy,
  rewriteNotice,
  selectedIds,
  assistantOpen,
  assistantPlacement = "fab",
  listScrollRef,
  loadMoreRef,
  cardRowRefs,
  onSelectionChange,
  onOpenCard,
  onCreateCard,
  onDeleteCard,
  onDeleteSelected,
  onAssistCard,
  onGenerateMnemonic,
  onRegenerateCard,
  onUndoRewrite,
  onDismissRewriteNotice,
  onOpenAssistant,
}: CreateCardsPaneProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addMenuRef = useRef<HTMLDivElement>(null);
  /** Keyboard cursor (index into `cards`); only drawn while the list has focus. */
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);
  const [listFocused, setListFocused] = useState(false);
  /** Anchor for shift-click range selection. */
  const anchorIdRef = useRef<string | null>(null);

  const selectedCount = selectedIds.size;
  const selecting = selectedCount > 0;
  const allLoadedSelected = cards.length > 0 && cards.every((c) => selectedIds.has(c.id));

  useEffect(() => {
    if (!addMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (!addMenuRef.current?.contains(e.target as Node)) setAddMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAddMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [addMenuOpen]);

  // Keep the cursor inside bounds when the list shrinks.
  useEffect(() => {
    if (cursorIndex !== null && cursorIndex >= cards.length) {
      setCursorIndex(cards.length > 0 ? cards.length - 1 : null);
    }
  }, [cards.length, cursorIndex]);

  const cardIndexById = useMemo(() => {
    const map = new Map<string, number>();
    cards.forEach((card, index) => map.set(card.id, index));
    return map;
  }, [cards]);

  const toggleCard = useCallback(
    (id: string, opts: { range?: boolean } = {}) => {
      const next = new Set(selectedIds);
      const anchorId = anchorIdRef.current;
      if (opts.range && anchorId && anchorId !== id) {
        const from = cardIndexById.get(anchorId);
        const to = cardIndexById.get(id);
        if (from !== undefined && to !== undefined) {
          const [start, end] = from < to ? [from, to] : [to, from];
          const shouldSelect = !selectedIds.has(id);
          for (let i = start; i <= end; i++) {
            const cardId = cards[i]!.id;
            if (shouldSelect) next.add(cardId);
            else next.delete(cardId);
          }
          onSelectionChange(next);
          return;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      anchorIdRef.current = id;
      onSelectionChange(next);
    },
    [cardIndexById, cards, onSelectionChange, selectedIds],
  );

  const selectAll = useCallback(() => {
    onSelectionChange(new Set(cards.map((c) => c.id)));
  }, [cards, onSelectionChange]);

  const clearSelection = useCallback(() => {
    anchorIdRef.current = null;
    onSelectionChange(new Set());
  }, [onSelectionChange]);

  const scrollCursorIntoView = useCallback(
    (index: number) => {
      const card = cards[index];
      if (!card) return;
      cardRowRefs.current.get(card.id)?.scrollIntoView({ block: "nearest" });
    },
    [cards, cardRowRefs],
  );

  const moveCursor = useCallback(
    (delta: number) => {
      if (cards.length === 0) return;
      const base =
        cursorIndex ??
        (focusedId && cardIndexById.has(focusedId) ? cardIndexById.get(focusedId)! : -1);
      const next = Math.min(cards.length - 1, Math.max(0, base + delta));
      setCursorIndex(next);
      scrollCursorIntoView(next);
    },
    [cards.length, cursorIndex, focusedId, cardIndexById, scrollCursorIntoView],
  );

  const handleListKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (isInteractiveTarget(e.target) && e.key !== "Escape") return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
        return;
      }
      if (e.key === "Escape") {
        if (selecting) {
          e.preventDefault();
          clearSelection();
        }
        return;
      }
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        moveCursor(1);
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        moveCursor(-1);
        return;
      }
      if (cursorIndex === null) return;
      const card = cards[cursorIndex];
      if (!card) return;

      if (e.key === " " || (e.key === "x" && !mod)) {
        e.preventDefault();
        toggleCard(card.id, { range: e.shiftKey });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        onOpenCard(card.id);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !mod && !busy) {
        e.preventDefault();
        if (selecting) onDeleteSelected();
        else onDeleteCard(card.id);
      }
    },
    [
      busy,
      cards,
      clearSelection,
      cursorIndex,
      moveCursor,
      onDeleteCard,
      onDeleteSelected,
      onOpenCard,
      selectAll,
      selecting,
      toggleCard,
    ],
  );

  const handleTileClick = useCallback(
    (e: ReactMouseEvent<HTMLElement>, card: DraftCard, index: number) => {
      setCursorIndex(index);
      // Checkbox / action buttons handle themselves; the tile body opens the editor.
      if (isInteractiveTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey) {
        toggleCard(card.id);
        return;
      }
      if (e.shiftKey && anchorIdRef.current) {
        toggleCard(card.id, { range: true });
        return;
      }
      if (selecting) {
        // While selecting, plain clicks add to the selection rather than
        // opening the editor — matches how file pickers behave.
        toggleCard(card.id);
        return;
      }
      onOpenCard(card.id);
    },
    [onOpenCard, selecting, toggleCard],
  );

  const countLabel = useMemo(() => {
    const n = projectId ? totalCards : cards.length;
    return `${n} ${n === 1 ? "card" : "cards"}`;
  }, [cards.length, projectId, totalCards]);

  const fade = motionTransition(motionTokens.duration.fast, motionTokens.easeOut, reducedMotion);

  return (
    <div className="dh-create-cards-pane" style={paneStyle}>
      <div className={`dh-create-cards-header${selecting ? " dh-create-cards-header--selecting" : ""}`}>
        <AnimatePresence initial={false} mode="wait">
          {selecting ? (
            <m.div
              key="selection"
              style={headerRowStyle}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={fade}
            >
              <div className="dh-create-cards-header__selected">
                <span>
                  {selectedCount} selected
                </span>
                {!allLoadedSelected ? (
                  <button
                    type="button"
                    className="dh-create-cards-header__selected-link"
                    onClick={selectAll}
                  >
                    Select all
                  </button>
                ) : null}
              </div>
              <div className="dh-create-cards-header__actions">
                <button
                  type="button"
                  className="create-topbar-control create-topbar-control--ai"
                  onClick={(e) => onOpenAssistant(e.currentTarget)}
                  disabled={busy}
                  title="Rewrite the selected cards with AI"
                >
                  <i className="ri-sparkling-2-line create-topbar-control__icon" aria-hidden />
                  <span className="dh-create-cards-header__label--hide-narrow">Rewrite with AI</span>
                </button>
                <button
                  type="button"
                  className="create-topbar-control create-topbar-control--danger"
                  onClick={onDeleteSelected}
                  disabled={busy}
                  title="Delete selected cards"
                >
                  <i className="ri-delete-bin-line create-topbar-control__icon" aria-hidden />
                  <span className="dh-create-cards-header__label--hide-narrow">Delete</span>
                </button>
                <button
                  type="button"
                  className="create-topbar-control create-topbar-control--icon"
                  onClick={clearSelection}
                  aria-label="Clear selection"
                  title="Clear selection (Esc)"
                >
                  <i className="ri-close-line create-topbar-control__icon" aria-hidden />
                </button>
              </div>
            </m.div>
          ) : (
            <m.div
              key="default"
              style={headerRowStyle}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={fade}
            >
              <div className="dh-create-cards-header__title">
                <span className="dh-create-cards-header__heading">Cards</span>
                <span className="dh-create-cards-header__count">
                  {cardsLoading ? "Loading…" : countLabel}
                </span>
              </div>
              <div className="dh-create-cards-header__actions">
                {cards.length > 0 ? (
                  <button
                    type="button"
                    className="create-topbar-control create-topbar-control--ai"
                    onClick={(e) => onOpenAssistant(e.currentTarget)}
                    disabled={busy}
                    aria-pressed={assistantOpen}
                    title="Edit cards with AI"
                  >
                    <i className="ri-sparkling-2-line create-topbar-control__icon" aria-hidden />
                    <span className="dh-create-cards-header__label--hide-narrow">AI edit</span>
                  </button>
                ) : null}
                <div ref={addMenuRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="create-topbar-control create-topbar-control--primary"
                    onClick={() => setAddMenuOpen((open) => !open)}
                    disabled={busy}
                    aria-expanded={addMenuOpen}
                    aria-haspopup="menu"
                  >
                    <i className="ri-add-line create-topbar-control__icon" aria-hidden />
                    Create card
                  </button>
                  {addMenuOpen ? (
                    <div className="dh-create-add-menu" role="menu" aria-label="Card type">
                      {CARD_EDITOR_TYPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          role="menuitem"
                          className="dh-menu-item"
                          disabled={busy}
                          onClick={() => {
                            setAddMenuOpen(false);
                            onCreateCard(opt.value);
                          }}
                        >
                          <i className={`${opt.icon} dh-menu-item__icon`} aria-hidden />
                          <span className="dh-menu-item__label">{opt.shortLabel}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </m.div>
          )}
        </AnimatePresence>
      </div>

      {cardsLoading ? (
        <CardListSkeleton rows={8} />
      ) : cards.length === 0 ? (
        <div style={emptyStyles.wrap}>
          <div style={emptyStyles.anchor}>
            <i
              className={cardsRefreshing ? "ri-loader-4-line icon-spin" : "ri-sparkling-2-line"}
              style={emptyStyles.icon}
              aria-hidden
            />
            <p style={emptyStyles.text}>
              {cardsRefreshing
                ? "Loading cards…"
                : projectId
                  ? "This deck has no cards yet. Add a source and press Generate, or create a card by hand."
                  : "Your cards will show up here after generation."}
            </p>
          </div>
        </div>
      ) : (
        <div
          ref={listScrollRef}
          className={`dh-create-cards-list${assistantOpen && assistantPlacement === "fab" ? " dh-create-cards-list--assistant-open" : ""}`}
          tabIndex={0}
          role="listbox"
          aria-multiselectable
          aria-label="Deck cards"
          title="↑↓ move · Space select · Enter edit · ⌘A select all · Esc clear"
          onKeyDown={handleListKeyDown}
          onFocus={() => setListFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setListFocused(false);
          }}
        >
          {cards.map((card, index) => {
            const selected = selectedIds.has(card.id);
            const active = card.id === focusedId && overlayOpen;
            const cursor = listFocused && cursorIndex === index;
            const sourceLabel = card.source_ref ? formatSegmentLabel(card.source_ref) : null;
            const question = card.type === "cloze" ? card.cloze_text ?? "" : cardPreviewText(card);
            const answer = tileAnswerText(card);
            const visibleTags = card.tags.slice(0, MAX_VISIBLE_TAGS);
            const hiddenTagCount = card.tags.length - visibleTags.length;
            const aiActions = supportsCardAiActions(card.type);
            const action = actionBusy.get(card.id) ?? null;
            const className = [
              "dh-create-card",
              selected ? "dh-create-card--selected" : "",
              active ? "dh-create-card--active" : "",
              cursor ? "dh-create-card--cursor" : "",
              pulseIds.has(card.id) || action ? "dh-create-card--pulse" : "",
              flashIds.has(card.id) ? "dh-create-card-row--flash" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <article
                key={card.id}
                ref={(el) => {
                  if (el) cardRowRefs.current.set(card.id, el);
                  else cardRowRefs.current.delete(card.id);
                }}
                className={className}
                role="option"
                aria-selected={selected}
                aria-label={`Card ${index + 1}`}
                onClick={(e) => handleTileClick(e, card, index)}
              >
                <div className="dh-create-card__head">
                  <input
                    type="checkbox"
                    className="dh-create-card__check"
                    checked={selected}
                    aria-label={selected ? `Deselect card ${index + 1}` : `Select card ${index + 1}`}
                    onChange={(e) => {
                      const native = e.nativeEvent as MouseEvent;
                      toggleCard(card.id, { range: Boolean(native.shiftKey) });
                    }}
                  />
                  <div className="dh-create-card__meta">
                    <span className="dh-create-card__index">#{index + 1}</span>
                    <span className={cardTypeChipClass(card.type)}>
                      {cardTypeLabel(card.type, "short")}
                    </span>
                    {sourceLabel ? (
                      <span className="dh-create-card__source" title={card.source_ref ?? undefined}>
                        <i className="ri-file-text-line" aria-hidden />
                        {sourceLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="dh-create-card__actions">
                    <button
                      type="button"
                      className="dh-create-card__action"
                      onClick={() => onOpenCard(card.id)}
                      aria-label={`Edit card ${index + 1}`}
                      title="Edit"
                    >
                      <i className="ri-pencil-line" aria-hidden />
                    </button>
                    {aiActions ? (
                      <>
                        <button
                          type="button"
                          className="dh-create-card__action dh-create-card__action--ai"
                          onClick={() => onGenerateMnemonic(card.id)}
                          disabled={busy || action !== null}
                          aria-label={`Rewrite card ${index + 1} as a mnemonic card`}
                          title="Make mnemonic card"
                        >
                          <i
                            className={
                              action === "mnemonic"
                                ? "ri-loader-4-line icon-spin"
                                : "ri-lightbulb-flash-line"
                            }
                            aria-hidden
                          />
                        </button>
                        <button
                          type="button"
                          className="dh-create-card__action dh-create-card__action--ai"
                          onClick={() => onRegenerateCard(card.id)}
                          disabled={busy || action !== null}
                          aria-label={`Regenerate card ${index + 1}`}
                          title="Regenerate card"
                        >
                          <i
                            className={
                              action === "regenerate" ? "ri-loader-4-line icon-spin" : "ri-refresh-line"
                            }
                            aria-hidden
                          />
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="dh-create-card__action dh-create-card__action--ai"
                      onClick={(e) => onAssistCard(card.id, e.currentTarget)}
                      disabled={busy}
                      aria-label={`Rewrite card ${index + 1} with AI`}
                      title="Rewrite with AI…"
                    >
                      <i className="ri-sparkling-2-line" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="dh-create-card__action dh-create-card__action--danger"
                      onClick={() => onDeleteCard(card.id)}
                      disabled={busy}
                      aria-label={`Delete card ${index + 1}`}
                      title="Delete"
                    >
                      <i className="ri-delete-bin-line" aria-hidden />
                    </button>
                  </div>
                </div>

                <div className="dh-create-card__body">
                  {question.trim() ? (
                    <div
                      className={`dh-create-card__question${
                        card.type === "cloze" ? " dh-create-card__question--clamp" : ""
                      }`}
                    >
                      <CardContentRenderer
                        content={question}
                        clozeMode={card.type === "cloze" ? "revealed" : undefined}
                        className="dh-card-content-renderer--compact"
                      />
                    </div>
                  ) : (
                    <div className="dh-create-card__question dh-create-card__empty">Empty card</div>
                  )}
                  {answer ? (
                    <>
                      <div className="dh-create-card__divider" aria-hidden />
                      <div className="dh-create-card__answer">
                        <CardContentRenderer
                          content={answer}
                          className="dh-card-content-renderer--compact"
                        />
                      </div>
                    </>
                  ) : null}
                </div>

                {rewriteNotice?.id === card.id ? (
                  <div className="dh-create-card__notice" role="status">
                    <i
                      className={
                        rewriteNotice.action === "mnemonic" ? "ri-lightbulb-flash-line" : "ri-refresh-line"
                      }
                      aria-hidden
                    />
                    <span>{rewriteNotice.action === "mnemonic" ? "Mnemonic card" : "Regenerated"}</span>
                    <button type="button" onClick={onUndoRewrite}>
                      Undo
                    </button>
                    <button
                      type="button"
                      className="dh-create-card__notice-dismiss"
                      onClick={onDismissRewriteNotice}
                      aria-label="Dismiss"
                    >
                      <i className="ri-close-line" aria-hidden />
                    </button>
                  </div>
                ) : null}

                {card.tags.length > 0 ? (
                  <div className="dh-create-card__tags" aria-label="Card tags">
                    {visibleTags.map((tag) => (
                      <span key={tag} className="study-tag-pill">
                        {tag}
                      </span>
                    ))}
                    {hiddenTagCount > 0 ? (
                      <span
                        className="dh-create-card__tag-more"
                        title={card.tags.slice(MAX_VISIBLE_TAGS).join(", ")}
                      >
                        +{hiddenTagCount}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
          {hasMoreCards ? (
            <div ref={loadMoreRef} className="dh-create-load-more" aria-hidden>
              {loadingMoreCards ? (
                <>
                  <i className="ri-loader-4-line icon-spin" /> Loading more…
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const paneStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  position: "relative",
};

const headerRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  width: "100%",
  minWidth: 0,
  height: "100%",
};

const emptyStyles: Record<string, React.CSSProperties> = {
  wrap: {
    position: "absolute",
    inset: "44px 0 0 0",
    pointerEvents: "none",
  },
  anchor: {
    position: "absolute",
    top: "calc(50% - 44px)",
    left: 0,
    right: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    padding: "0 40px",
    boxSizing: "border-box",
    textAlign: "center",
  },
  icon: {
    fontSize: 36,
    lineHeight: 1,
    color: "var(--ink-300)",
    flexShrink: 0,
  },
  text: {
    margin: 0,
    font: "400 14px/20px var(--font-sans)",
    color: "var(--fg-4)",
    maxWidth: 300,
  },
};
