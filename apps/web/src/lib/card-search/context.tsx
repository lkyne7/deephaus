"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CardSearchDialog } from "@/components/card-search-dialog";

type CardSearchContextValue = {
  open: boolean;
  openSearch: () => void;
  closeSearch: () => void;
};

const CardSearchContext = createContext<CardSearchContextValue | null>(null);

/** True when focus is in an editable surface with a non-collapsed text selection. */
function hasRichTextSelection(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return false;
  if (!active.isContentEditable && !active.closest?.("[contenteditable='true']")) {
    return false;
  }
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  const anchor = selection.anchorNode;
  if (!anchor) return false;
  const root =
    active.closest?.(".ProseMirror, [contenteditable='true']") ??
    (active.isContentEditable ? active : null);
  return Boolean(root?.contains(anchor));
}

export function CardSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openSearch = useCallback(() => setOpen(true), []);
  const closeSearch = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "k") return;
      // Rich-text editors own Mod+K when text is selected (hyperlink UI).
      if (e.defaultPrevented) return;
      if (hasRichTextSelection()) return;
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo(
    () => ({ open, openSearch, closeSearch }),
    [open, openSearch, closeSearch],
  );

  return (
    <CardSearchContext.Provider value={value}>
      {children}
      <CardSearchDialog open={open} onClose={closeSearch} />
    </CardSearchContext.Provider>
  );
}

export function useCardSearch() {
  const ctx = useContext(CardSearchContext);
  if (!ctx) {
    throw new Error("useCardSearch must be used within CardSearchProvider");
  }
  return ctx;
}
