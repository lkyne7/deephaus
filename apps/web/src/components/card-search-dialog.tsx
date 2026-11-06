"use client";

import "./card-search-dialog.css";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CardTypeBadge } from "@/components/card-type-badge";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { searchActions } from "@/lib/search/actions";
import type { GlobalSearchHit, GlobalSearchKind, GlobalSearchResponse } from "@/lib/search/global-search";
import { motionTokens, motionTransition, scaleIn } from "@/lib/motion";

const DEBOUNCE_MS = 200;

const KIND_ORDER: GlobalSearchKind[] = ["card", "deck", "community"];

const KIND_LABEL: Record<GlobalSearchKind, string> = {
  deck: "Decks",
  card: "Cards",
  community: "Community",
};

const KIND_ICON: Record<GlobalSearchKind, string> = {
  deck: "ri-folder-3-line",
  card: "ri-stack-line",
  community: "ri-group-line",
};

type Props = {
  open: boolean;
  onClose: () => void;
};

function truncate(text: string, max = 100) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function groupedResults(results: GlobalSearchHit[]) {
  return KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABEL[kind],
    items: results.filter((hit) => hit.kind === kind),
  })).filter((group) => group.items.length > 0);
}

export function CardSearchDialog({ open, onClose }: Props) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchHit[]>([]);
  const [totals, setTotals] = useState<GlobalSearchResponse["totals"]>({
    deck: 0,
    card: 0,
    community: 0,
  });
  const [searchedQuery, setSearchedQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const trimmedQuery = query.trim();
  // Results for an older query are hidden so Enter can't open a stale hit.
  const pending = trimmedQuery !== "" && searchedQuery !== trimmedQuery;
  const hits = useMemo(() => (pending ? [] : results), [pending, results]);
  const groups = useMemo(() => groupedResults(hits), [hits]);
  const actions = useMemo(() => searchActions(query), [query]);
  const items = useMemo(
    () => [...groups.flatMap((group) => group.items), ...actions],
    [groups, actions],
  );
  const totalMatches = totals.deck + totals.card + totals.community;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setDebouncedQuery("");
    setSearchedQuery("");
    setResults([]);
    setTotals({ deck: 0, card: 0, community: 0 });
    setError(null);
    setActiveIndex(-1);
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    if (!debouncedQuery) {
      setResults([]);
      setTotals({ deck: 0, card: 0, community: 0 });
      setSearchedQuery("");
      setError(null);
      setActiveIndex(-1);
      return;
    }

    let cancelled = false;
    setError(null);

    void (async () => {
      try {
        const params = new URLSearchParams({ q: debouncedQuery, limit: "4" });
        const res = await fetch(`/api/search?${params}`, { credentials: "include" });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as GlobalSearchResponse;
        if (cancelled) return;
        setResults(data.results);
        setTotals(data.totals);
        // Actions are never preselected: Enter with no hit searches all cards.
        setActiveIndex(data.results.length > 0 ? 0 : -1);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
        setTotals({ deck: 0, card: 0, community: 0 });
        setActiveIndex(-1);
      } finally {
        if (!cancelled) setSearchedQuery(debouncedQuery);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open]);

  useEffect(() => {
    listRef.current
      ?.querySelector(".card-search-item-active")
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const openHref = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  const searchAllCards = useCallback(() => {
    openHref(trimmedQuery ? `/cards?q=${encodeURIComponent(trimmedQuery)}` : "/cards");
  }, [openHref, trimmedQuery]);

  const openActive = useCallback(() => {
    const item = items[activeIndex];
    if (item) {
      openHref(item.href);
      return;
    }
    if (trimmedQuery) searchAllCards();
    else onClose();
  }, [activeIndex, items, onClose, openHref, searchAllCards, trimmedQuery]);

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length === 0) return;
      setActiveIndex((index) => (index + 1) % items.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length === 0) return;
      setActiveIndex((index) => (index <= 0 ? items.length - 1 : index - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      openActive();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    openActive();
  }

  let runningIndex = -1;

  return (
    <AnimatePresence>
      {open && (
        <m.div
          key="card-search-overlay"
          className="card-search-overlay"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTransition(motionTokens.duration.fast, undefined, reducedMotion ?? false)}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <m.div
            className="card-search-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            variants={scaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={motionTransition(undefined, undefined, reducedMotion ?? false)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleSubmit}>
              <div className="card-search-input-wrap">
                <i className="ri-search-line" aria-hidden />
                <input
                  ref={inputRef}
                  type="search"
                  className="card-search-input"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(-1);
                  }}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Search or jump to…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Search decks, cards, and community decks"
                />
                <kbd className="dh-kbd">Esc</kbd>
              </div>
            </form>

            <div ref={listRef} className="card-search-results" aria-live="polite">
              {pending ? (
                <div className="card-search-group" aria-busy aria-label="Searching">
                  {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="card-search-skeleton">
                      <SkeletonBar width={16} height={16} radius={5} />
                      <SkeletonBar width={`${68 - i * 8}%`} height={12} />
                    </div>
                  ))}
                </div>
              ) : trimmedQuery && error ? (
                <p className="card-search-error">{error}</p>
              ) : trimmedQuery && hits.length === 0 ? (
                <p className="card-search-hint">No results for &ldquo;{trimmedQuery}&rdquo;</p>
              ) : (
                groups.map((group) => (
                  <div key={group.kind} className="card-search-group">
                    <p className="card-search-group-label">{group.label}</p>
                    {group.items.map((hit) => {
                      runningIndex += 1;
                      const index = runningIndex;
                      return (
                        <button
                          key={`${hit.kind}-${hit.id}`}
                          type="button"
                          className={`card-search-item${index === activeIndex ? " card-search-item-active" : ""}`}
                          onClick={() => openHref(hit.href)}
                          onMouseEnter={() => setActiveIndex(index)}
                        >
                          <i className={KIND_ICON[hit.kind]} aria-hidden />
                          <span className="card-search-item-title">
                            {truncate(hit.title) || "Untitled"}
                          </span>
                          {hit.cardType && hit.cardType !== "basic" ? (
                            <CardTypeBadge type={hit.cardType} />
                          ) : null}
                          {hit.kind === "deck" ? (
                            hit.dueCount ? (
                              <span className="dh-count dh-count--due">{hit.dueCount} due</span>
                            ) : null
                          ) : hit.subtitle ? (
                            <span className="card-search-item-meta">{hit.subtitle}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}

              <div className="card-search-group">
                <p className="card-search-group-label">Actions</p>
                {actions.map((action, actionIndex) => {
                  const index = hits.length + actionIndex;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      className={`card-search-item${index === activeIndex ? " card-search-item-active" : ""}`}
                      onClick={() => openHref(action.href)}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <i className={action.icon} aria-hidden />
                      <span className="card-search-item-title">{action.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="card-search-footer">
              <span>
                <kbd className="dh-kbd">↑</kbd> <kbd className="dh-kbd">↓</kbd> move
              </span>
              <span>
                <kbd className="dh-kbd">↵</kbd> open
              </span>
              <span className="dh-spacer" />
              {!pending && totalMatches > hits.length ? <span>{totalMatches} results</span> : null}
              <button type="button" onClick={searchAllCards}>
                Search all cards
              </button>
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
