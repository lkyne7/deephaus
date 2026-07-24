"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Shared default for Dashboard, Decks, and Community list/card toggles. */
export type DeckViewMode = "table" | "grid";

export const DEFAULT_DECK_VIEW_MODE: DeckViewMode = "table";
export const DECK_VIEW_MODE_STORAGE_KEY = "deephaus.deckViewMode";

function isDeckViewMode(value: string | null): value is DeckViewMode {
  return value === "table" || value === "grid";
}

export function readStoredDeckViewMode(): DeckViewMode {
  if (typeof window === "undefined") return DEFAULT_DECK_VIEW_MODE;
  try {
    const raw = window.localStorage.getItem(DECK_VIEW_MODE_STORAGE_KEY);
    return isDeckViewMode(raw) ? raw : DEFAULT_DECK_VIEW_MODE;
  } catch {
    return DEFAULT_DECK_VIEW_MODE;
  }
}

export function writeStoredDeckViewMode(mode: DeckViewMode): void {
  try {
    window.localStorage.setItem(DECK_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore quota / private mode errors.
  }
}

const listeners = new Set<() => void>();
let initialized = false;
let mode: DeckViewMode = DEFAULT_DECK_VIEW_MODE;

const SERVER_SNAPSHOT: DeckViewMode = DEFAULT_DECK_VIEW_MODE;

function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  mode = readStoredDeckViewMode();
}

function setMode(next: DeckViewMode) {
  ensureInitialized();
  if (mode === next) return;
  mode = next;
  writeStoredDeckViewMode(next);
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  ensureInitialized();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): DeckViewMode {
  ensureInitialized();
  return mode;
}

function getServerSnapshot(): DeckViewMode {
  return SERVER_SNAPSHOT;
}

/** Current preferred deck list layout (list/table vs cards/grid). */
export function useDeckViewMode(): {
  viewMode: DeckViewMode;
  setViewMode: (mode: DeckViewMode) => void;
} {
  const viewMode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setViewMode = useCallback((next: DeckViewMode) => {
    setMode(next);
  }, []);
  return { viewMode, setViewMode };
}
