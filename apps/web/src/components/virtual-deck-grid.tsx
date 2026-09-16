"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";

/** Measured rows allow wrapping badges and large text without overlapping cards. */
export function VirtualDeckGrid({ ids, renderDeck }: {
  ids: string[];
  renderDeck: (index: number) => ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const [focused, setFocused] = useState<string | null>(null);
  const hint = useId();
  const focusedIndex = focused ? ids.indexOf(focused) : -1;
  const rows = useVirtualizer({
    count: Math.ceil(ids.length / columns),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 220,
    overscan: 2,
    gap: 16,
    getItemKey: index => `${columns}:${ids[index * columns]}`,
    rangeExtractor: range => [...new Set([
      ...defaultRangeExtractor(range),
      ...(focusedIndex >= 0 ? [Math.floor(focusedIndex / columns)] : []),
    ])].sort((a, b) => a - b),
  });

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const resize = new ResizeObserver(() => setColumns(Math.max(1, Math.floor((element.clientWidth + 16) / 256))));
    resize.observe(element);
    return () => resize.disconnect();
  }, []);

  function focusCard(index: number) {
    const bounded = Math.max(0, Math.min(ids.length - 1, index));
    setFocused(ids[bounded]!);
    rows.scrollToIndex(Math.floor(bounded / columns));
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-grid-index="${bounded}"] [data-deck-id]`)?.focus());
  }

  return <>
    <span id={hint} style={{ position: "absolute", width: 1, height: 1, padding: 0, overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap" }}>Use arrow keys to move between decks. Home and End move to the first and last deck.</span>
    <div ref={scrollRef} role="list" aria-label="Decks" aria-describedby={hint}
      style={{ height: 640, maxHeight: "70vh", overflowY: "auto", padding: 3 }}
      onFocusCapture={event => {
        const card = (event.target as HTMLElement).closest<HTMLElement>("[data-grid-index]");
        if (card) setFocused(ids[Number(card.dataset.gridIndex)]!);
      }}
      onKeyDown={event => {
        const target = event.target as HTMLElement;
        // Nested links and action menus keep their own keyboard behavior.
        if (!target.hasAttribute("data-deck-id")) return;
        const index = ids.indexOf(target.dataset.deckId!);
        const next = { ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - columns, ArrowDown: index + columns, Home: 0, End: ids.length - 1 }[event.key];
        if (next !== undefined) { event.preventDefault(); focusCard(next); }
      }}>
      <div role="presentation" style={{ position: "relative", height: rows.getTotalSize() }}>
        {rows.getVirtualItems().map(row => <div role="presentation" key={row.key} data-index={row.index} ref={rows.measureElement}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start}px)`, display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 16 }}>
          {ids.slice(row.index * columns, (row.index + 1) * columns).map((id, offset) => {
            const index = row.index * columns + offset;
            return <div key={id} role="listitem" aria-posinset={index + 1} aria-setsize={ids.length} data-grid-index={index}>{renderDeck(index)}</div>;
          })}
        </div>)}
      </div>
    </div>
  </>;
}
