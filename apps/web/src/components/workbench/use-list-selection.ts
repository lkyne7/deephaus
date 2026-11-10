"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";

/**
 * Focus and multi-selection for a workbench list (Cards, Decks).
 *
 * One row is always focused while the list has rows; it is the one the side
 * panel shows. Ticking, shift-click and cmd/ctrl-click build up a selection,
 * and more than one selected row is "bulk" mode.
 */
export function useListSelection<T extends { id: string }>(items: T[]) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);

  // Keep a row focused: the first one when nothing is, or when the focused row left the list.
  useEffect(() => {
    if (items.length === 0) {
      setFocusedId(null);
      return;
    }
    if (!focusedId || !items.some((item) => item.id === focusedId)) {
      const firstId = items[0].id;
      // Decided from the latest value, not the one this effect saw: a page that
      // opens on a row named in its URL focuses it in the same pass, and that
      // must not be undone if this effect runs again with what it first saw.
      setFocusedId((current) =>
        current && items.some((item) => item.id === current) ? current : firstId,
      );
      setAnchorIndex(0);
      setCheckedIds((prev) => (prev.size > 0 ? prev : new Set([firstId])));
    }
  }, [items, focusedId]);

  const focused = useMemo(
    () => items.find((item) => item.id === focusedId) ?? null,
    [items, focusedId],
  );

  const checkedItems = useMemo(
    () => items.filter((item) => checkedIds.has(item.id)),
    [items, checkedIds],
  );

  /** What an action applies to: the selection, or else the focused row. */
  const actionTargets = useMemo(() => {
    if (checkedIds.size > 0) return checkedItems;
    return focused ? [focused] : [];
  }, [checkedIds.size, checkedItems, focused]);

  const selectRange = useCallback(
    (from: number, to: number) => {
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      setCheckedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          const item = items[i];
          if (item) next.add(item.id);
        }
        return next;
      });
    },
    [items],
  );

  const handleRowClick = useCallback(
    (item: T, index: number, event: Pick<ReactMouseEvent, "shiftKey" | "metaKey" | "ctrlKey">) => {
      setFocusedId(item.id);

      if (event.shiftKey && anchorIndex != null) {
        selectRange(anchorIndex, index);
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        setCheckedIds((prev) => {
          const next = new Set(prev);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
        setAnchorIndex(index);
        return;
      }

      setCheckedIds(new Set([item.id]));
      setAnchorIndex(index);
    },
    [anchorIndex, selectRange],
  );

  const toggleChecked = useCallback((id: string, index: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setAnchorIndex(index);
  }, []);

  const selectAll = useCallback(() => {
    setCheckedIds(new Set(items.map((item) => item.id)));
    setAnchorIndex(0);
  }, [items]);

  const clearSelection = useCallback(() => {
    setCheckedIds(new Set());
    setAnchorIndex(null);
  }, []);

  /** Focus one row and make it the whole selection. */
  const focusOnly = useCallback(
    (id: string) => {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) return false;
      setFocusedId(id);
      setAnchorIndex(index);
      setCheckedIds(new Set([id]));
      return true;
    },
    [items],
  );

  const moveFocus = useCallback(
    (delta: number) => {
      if (items.length === 0) return;
      const idx = items.findIndex((item) => item.id === focusedId);
      const nextIdx = idx < 0 ? 0 : Math.max(0, Math.min(items.length - 1, idx + delta));
      const nextId = items[nextIdx].id;
      setFocusedId(nextId);
      setAnchorIndex(nextIdx);
      setCheckedIds((prev) => (prev.size > 1 ? prev : new Set([nextId])));
    },
    [items, focusedId],
  );

  const toggleFocused = useCallback(() => {
    const idx = items.findIndex((item) => item.id === focusedId);
    if (idx >= 0 && focusedId) toggleChecked(focusedId, idx);
  }, [items, focusedId, toggleChecked]);

  return {
    focusedId,
    setFocusedId,
    focused,
    checkedIds,
    checkedItems,
    actionTargets,
    /** More than one row is selected. */
    bulk: checkedIds.size > 1,
    handleRowClick,
    toggleChecked,
    toggleFocused,
    selectAll,
    clearSelection,
    focusOnly,
    moveFocus,
  };
}
