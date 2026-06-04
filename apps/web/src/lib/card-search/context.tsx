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

export function CardSearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const openSearch = useCallback(() => setOpen(true), []);
  const closeSearch = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
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
