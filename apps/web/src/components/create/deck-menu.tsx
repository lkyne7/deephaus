"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/** Long deck lists get a filter box. */
const FILTER_MIN_DECKS = 8;

type Props = {
  decks: Array<{ id: string; name: string }>;
  currentId: string | null;
  placement: "up" | "down";
  align: "left" | "right";
  onNew: () => void;
  onSelect: (deckId: string) => void;
};

/** Deck picker menu shared by the composer's deck pill and the workspace switcher. */
export function DeckMenu({ decks, currentId, placement, align, onNew, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const showFilter = decks.length >= FILTER_MIN_DECKS;

  useEffect(() => {
    if (showFilter) filterRef.current?.focus();
  }, [showFilter]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? decks.filter((deck) => deck.name.toLowerCase().includes(needle)) : decks;
  }, [decks, query]);

  return (
    <div
      role="menu"
      aria-label="Choose a deck"
      className={`dhc-menu dhc-menu--${placement} dhc-menu--${align}`}
      style={{ width: 320 }}
    >
      <button
        type="button"
        role="menuitem"
        className={`dh-menu-item${currentId ? "" : " is-active"}`}
        onClick={onNew}
      >
        <i className="ri-add-line dh-menu-item__icon" aria-hidden />
        <span className="dh-menu-item__label">New deck</span>
        {currentId ? null : <i className="ri-check-line dh-menu-item__check" aria-hidden />}
      </button>

      {decks.length > 0 ? <div className="dhc-menu__sep" /> : null}

      {showFilter ? (
        <label className="dhc-menu__filter">
          <i className="ri-search-line" aria-hidden />
          <input
            ref={filterRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a deck…"
            aria-label="Find a deck"
          />
        </label>
      ) : null}

      <div className="dhc-menu__list">
        {visible.map((deck) => {
          const active = deck.id === currentId;
          return (
            <button
              key={deck.id}
              type="button"
              role="menuitem"
              className={`dh-menu-item${active ? " is-active" : ""}`}
              onClick={() => onSelect(deck.id)}
            >
              <i className="ri-folder-3-line dh-menu-item__icon" aria-hidden />
              <span className="dh-menu-item__label">{deck.name}</span>
              {active ? <i className="ri-check-line dh-menu-item__check" aria-hidden /> : null}
            </button>
          );
        })}
        {showFilter && visible.length === 0 ? (
          <p className="dhc-menu__empty">No decks match “{query.trim()}”.</p>
        ) : null}
      </div>
    </div>
  );
}
