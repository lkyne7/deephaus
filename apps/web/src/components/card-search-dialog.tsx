"use client";

import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CardTypeBadge } from "@/components/card-type-badge";
import {
  type BrowseCardRow,
  cardPreviewText,
} from "@/lib/browse/cards";
import { motionTokens, motionTransition, scaleIn } from "@/lib/motion";

const PREVIEW_LIMIT = 8;
const DEBOUNCE_MS = 200;

type Props = {
  open: boolean;
  onClose: () => void;
};

function truncate(text: string, max = 100) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function CardSearchDialog({ open, onClose }: Props) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<BrowseCardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setTotal(0);
    setError(null);
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
      setTotal(0);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const params = new URLSearchParams({
          limit: String(PREVIEW_LIMIT),
          offset: "0",
          q: debouncedQuery,
        });
        const res = await fetch(`/api/browse/cards?${params}`, { credentials: "include" });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { cards: BrowseCardRow[]; total: number };
        if (cancelled) return;
        setResults(data.cards);
        setTotal(data.total);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
        setTotal(0);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open]);

  const goToBrowse = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      onClose();
      if (!trimmed) {
        router.push("/decks");
        return;
      }
      router.push(`/decks?q=${encodeURIComponent(trimmed)}`);
    },
    [onClose, router],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    goToBrowse(query);
  }

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
            aria-label="Search cards"
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
                  placeholder="Search cards…"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Search cards"
                />
                <kbd className="card-search-kbd">↵</kbd>
              </div>
            </form>

            <div className="card-search-results" aria-live="polite">
              {!debouncedQuery ? (
                <p className="card-search-hint">Type to find cards across all decks</p>
              ) : loading ? (
                <p className="card-search-hint">Searching…</p>
              ) : error ? (
                <p className="card-search-error">{error}</p>
              ) : results.length === 0 ? (
                <p className="card-search-hint">No cards match &ldquo;{debouncedQuery}&rdquo;</p>
              ) : (
                <>
                  <ul className="card-search-list">
                    {results.map((card) => {
                      const preview = truncate(cardPreviewText(card));
                      return (
                        <li key={card.id}>
                          <button
                            type="button"
                            className="card-search-item"
                            onClick={() => goToBrowse(debouncedQuery)}
                          >
                            <span className="card-search-item-main">
                              <span className="card-search-item-preview">
                                {preview || "Empty card"}
                              </span>
                              <span className="card-search-item-meta">
                                <span className="card-search-item-deck">{card.deck_name}</span>
                                <CardTypeBadge type={card.type} />
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {total > results.length ? (
                    <p className="card-search-footer">
                      {total} match{total === 1 ? "" : "es"} — press Enter to see all on Browse
                    </p>
                  ) : (
                    <p className="card-search-footer">Press Enter to open in Browse</p>
                  )}
                </>
              )}
            </div>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
