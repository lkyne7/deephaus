"use client";

import type { SourceType } from "@deephaus/shared";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CardTypeBadge } from "@/components/card-type-badge";
import type { GlobalSearchHit, GlobalSearchKind, GlobalSearchResponse } from "@/lib/search/global-search";
import { sourceTypeIconClass } from "@/lib/sources/file-types";
import { motionTokens, motionTransition, scaleIn } from "@/lib/motion";

const DEBOUNCE_MS = 200;

const KIND_ORDER: GlobalSearchKind[] = ["card", "deck", "note", "community"];

const KIND_LABEL: Record<GlobalSearchKind, string> = {
  deck: "Decks",
  card: "Flashcards",
  note: "Notes",
  community: "Community",
};

const KIND_ICON: Record<GlobalSearchKind, string> = {
  deck: "ri-folder-line",
  card: "ri-stack-line",
  note: "ri-file-text-line",
  community: "ri-community-line",
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
    note: 0,
    community: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const flatResults = results;
  const groups = useMemo(() => groupedResults(results), [results]);
  const totalMatches = totals.deck + totals.card + totals.note + totals.community;

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
    setResults([]);
    setTotals({ deck: 0, card: 0, note: 0, community: 0 });
    setError(null);
    setActiveIndex(0);
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
      setTotals({ deck: 0, card: 0, note: 0, community: 0 });
      setLoading(false);
      setError(null);
      setActiveIndex(0);
      return;
    }

    let cancelled = false;
    setLoading(true);
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
        setActiveIndex(0);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
        setTotals({ deck: 0, card: 0, note: 0, community: 0 });
        setActiveIndex(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open]);

  const openHit = useCallback(
    (hit: GlobalSearchHit) => {
      onClose();
      router.push(hit.href);
    },
    [onClose, router],
  );

  const openActive = useCallback(() => {
    const hit = flatResults[activeIndex];
    if (hit) {
      openHit(hit);
      return;
    }
    const trimmed = query.trim();
    onClose();
    if (trimmed) {
      router.push(`/decks?q=${encodeURIComponent(trimmed)}`);
    }
  }, [activeIndex, flatResults, onClose, openHit, query, router]);

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flatResults.length === 0) return;
      setActiveIndex((index) => (index + 1) % flatResults.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flatResults.length === 0) return;
      setActiveIndex((index) => (index - 1 + flatResults.length) % flatResults.length);
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
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Search decks, cards, notes, community…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Search decks, cards, notes, and community decks"
                />
                <kbd className="card-search-kbd">↵</kbd>
              </div>
            </form>

            <div className="card-search-results" aria-live="polite">
              {!debouncedQuery ? (
                <p className="card-search-hint">
                  Search decks, flashcards, notes, and community decks
                </p>
              ) : loading ? (
                <p className="card-search-hint">Searching…</p>
              ) : error ? (
                <p className="card-search-error">{error}</p>
              ) : results.length === 0 ? (
                <p className="card-search-hint">No results for &ldquo;{debouncedQuery}&rdquo;</p>
              ) : (
                <>
                  {groups.map((group) => (
                    <div key={group.kind} className="card-search-group">
                      <p className="card-search-group-label">{group.label}</p>
                      <ul className="card-search-list">
                        {group.items.map((hit) => {
                          runningIndex += 1;
                          const index = runningIndex;
                          const active = index === activeIndex;
                          return (
                            <li key={`${hit.kind}-${hit.id}`}>
                              <button
                                type="button"
                                className={`card-search-item${active ? " card-search-item-active" : ""}`}
                                onClick={() => openHit(hit)}
                                onMouseEnter={() => setActiveIndex(index)}
                              >
                                <span className="card-search-item-icon" aria-hidden>
                                  <i
                                    className={
                                      hit.kind === "note" && hit.sourceType
                                        ? sourceTypeIconClass(hit.sourceType as SourceType)
                                        : KIND_ICON[hit.kind]
                                    }
                                  />
                                </span>
                                <span className="card-search-item-main">
                                  <span className="card-search-item-preview">
                                    {truncate(hit.title) || "Untitled"}
                                  </span>
                                  {hit.subtitle ? (
                                    <span className="card-search-item-meta">
                                      <span className="card-search-item-deck">{hit.subtitle}</span>
                                      {hit.cardType ? <CardTypeBadge type={hit.cardType} /> : null}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                  <p className="card-search-footer">
                    {totalMatches > results.length
                      ? `${totalMatches} results — use ↑↓ and Enter to open`
                      : "Use ↑↓ and Enter to open a result"}
                  </p>
                </>
              )}
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
