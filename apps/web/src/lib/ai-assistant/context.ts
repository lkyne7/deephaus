"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * AI assistant page context
 * ---------------------------------------------------------------------
 * Pages register what the assistant can "see" (current card, deck, …)
 * through `useAiContext`. The topbar assistant popover reads the store
 * via `useAiContextValue`. Module-level store + `useSyncExternalStore`
 * mirrors the theme store pattern (see theme-provider.tsx for why we
 * avoid React Context here).
 */

export type AiCardSnapshot = {
  id?: string | null;
  type: string;
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
};

export type AiPageContext =
  | { page: "study-card"; deckId: string; card: AiCardSnapshot }
  | { page: "deck"; deckId: string; deckName?: string }
  | { page: "dashboard" }
  | { page: "decks-list" }
  | { page: "browse" }
  | { page: "create"; deckId?: string | null; card?: AiCardSnapshot | null; sourceText?: string | null }
  | { page: "community" };

const listeners = new Set<() => void>();
let state: AiPageContext | null = null;

function setAiContext(next: AiPageContext | null) {
  state = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): AiPageContext | null {
  return state;
}

function getServerSnapshot(): AiPageContext | null {
  return null;
}

/** Register the AI context for the current page. Pass null to expose nothing. */
export function useAiContext(ctx: AiPageContext | null): void {
  // Serialize so a structurally-equal inline object doesn't retrigger the effect.
  const key = JSON.stringify(ctx);

  useEffect(() => {
    const parsed = key === "null" ? null : (JSON.parse(key) as AiPageContext);
    setAiContext(parsed);
    return () => setAiContext(null);
  }, [key]);
}

/** Read the currently registered AI context (popover side). */
export function useAiContextValue(): AiPageContext | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Route-based fallback for pages that don't explicitly register context. */
export function contextFromPathname(pathname: string): AiPageContext | null {
  if (pathname === "/dashboard" || pathname === "/") return { page: "dashboard" };
  if (pathname === "/study") return { page: "decks-list" };
  if (pathname === "/decks") return { page: "browse" };
  if (pathname === "/decks/new") return { page: "create" };
  if (pathname === "/community") return { page: "community" };

  const deckMatch = /^\/decks\/([^/]+)(?:\/study)?$/.exec(pathname);
  if (deckMatch && deckMatch[1] !== "new" && deckMatch[1] !== "import") {
    return { page: "deck", deckId: deckMatch[1] };
  }

  return null;
}

/** Resolve the effective context: explicit registration wins over route fallback. */
export function useResolvedAiContext(pathname: string): AiPageContext | null {
  const registered = useAiContextValue();
  return useMemo(
    () => registered ?? contextFromPathname(pathname),
    [registered, pathname],
  );
}
