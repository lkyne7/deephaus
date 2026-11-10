"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

type DeckOption = { id: string; name: string };

/** A bulk-bar button with a panel that opens above it. */
function BulkPopover({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div
      ref={rootRef}
      className="dh-bench-pop"
      onKeyDown={(event) => {
        // Escape closes the panel; it must not reach the bar, which would drop the selection.
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open ? (
        <div className="dh-bench-pop__panel" role="dialog" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** "Move": pick the deck the selected cards go to. */
export function MoveCardsMenu({
  decks,
  count,
  disabled,
  onMove,
}: {
  decks: DeckOption[];
  count: number;
  disabled: boolean;
  onMove: (deck: DeckOption) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? decks.filter((deck) => deck.name.toLowerCase().includes(needle)) : decks),
    [decks, needle],
  );

  return (
    <BulkPopover label="Move" disabled={disabled}>
      {(close) => (
        <>
          <div className="dh-bench-pop__title">Move {count.toLocaleString()} cards to</div>
          {decks.length > 7 ? (
            <input
              className="input dh-bench-pop__input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a deck…"
              aria-label="Find a deck"
              autoFocus
            />
          ) : null}
          <div className="dh-bench-pop__list" role="listbox" aria-label="Decks">
            {shown.length === 0 ? (
              <div className="dh-bench-pop__hint">No deck matches.</div>
            ) : (
              shown.map((deck) => (
                <button
                  key={deck.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="dh-menu-row"
                  onClick={() => {
                    close();
                    setQuery("");
                    onMove(deck);
                  }}
                >
                  <i className="ri-folder-3-line" aria-hidden />
                  <span className="dh-bench-pop__name">{deck.name}</span>
                </button>
              ))
            )}
          </div>
          <div className="dh-bench-pop__hint">Review history moves with the cards.</div>
        </>
      )}
    </BulkPopover>
  );
}

/** "Tag": add one tag to the selected cards, or take it off them. */
export function TagCardsMenu({
  knownTags,
  selectionTags,
  count,
  disabled,
  onApply,
}: {
  /** Tags already used on the cards in view, offered as suggestions. */
  knownTags: string[];
  /** Tags on the selected cards, offered for removal. */
  selectionTags: string[];
  count: number;
  disabled: boolean;
  onApply: (mode: "tag" | "untag", tag: string) => void;
}) {
  const listId = useId();
  const [value, setValue] = useState("");
  const tag = value.trim();
  const onSelection = selectionTags.includes(tag);

  return (
    <BulkPopover label="Tag" disabled={disabled}>
      {(close) => {
        const apply = (mode: "tag" | "untag", chosen = tag) => {
          if (!chosen) return;
          close();
          setValue("");
          onApply(mode, chosen);
        };
        return (
          <>
            <div className="dh-bench-pop__title">Tag {count.toLocaleString()} cards</div>
            <form
              className="dh-bench-pop__row"
              onSubmit={(e) => {
                e.preventDefault();
                apply("tag");
              }}
            >
              <input
                className="input dh-bench-pop__input"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Tag name"
                aria-label="Tag name"
                list={listId}
                maxLength={80}
                autoFocus
              />
              <datalist id={listId}>
                {knownTags.map((known) => (
                  <option key={known} value={known} />
                ))}
              </datalist>
              <button type="submit" className="btn btn-primary btn-sm" disabled={!tag}>
                Add
              </button>
            </form>
            {onSelection ? (
              <button type="button" className="dh-menu-row" onClick={() => apply("untag")}>
                <i className="ri-close-line" aria-hidden />
                <span className="dh-bench-pop__name">Remove “{tag}” instead</span>
              </button>
            ) : null}
            {selectionTags.length > 0 ? (
              <>
                <div className="dh-bench-pop__hint">On these cards. Click one to remove it.</div>
                <div className="dh-bench-pop__tags">
                  {selectionTags.map((existing) => (
                    <button
                      key={existing}
                      type="button"
                      className="dh-pill dh-bench-pop__tag"
                      aria-label={`Remove tag ${existing}`}
                      onClick={() => apply("untag", existing)}
                    >
                      {existing}
                      <i className="ri-close-line" aria-hidden />
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        );
      }}
    </BulkPopover>
  );
}
