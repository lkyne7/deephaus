"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CardEditOverlay, type OverlayCard } from "@/components/card-edit-overlay";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { apiFetch } from "@/lib/api/fetch";
import { cardAnswerText, cardPreviewText, type BrowseCardRow } from "@/lib/browse/cards";
import { invalidateDeckCaches } from "@/lib/client-cache/prefetch";
import "@/components/rich-text/rich-text.css";

const PAGE_SIZE = 50;

export function DeckCardsTab({ deckId }: { deckId: string }) {
  const router = useRouter();
  const [cards, setCards] = useState<BrowseCardRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<BrowseCardRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  const loadMore = useCallback(
    async (offset: number) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setFailed(false);
      try {
        const params = new URLSearchParams({
          deck_id: deckId,
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        const res = await apiFetch(`/api/browse/cards?${params}`, { credentials: "include" });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { cards: BrowseCardRow[]; total: number };
        setCards((prev) => (offset === 0 ? data.cards : [...prev, ...data.cards]));
        setTotal(data.total);
      } catch {
        setFailed(true);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [deckId],
  );

  useEffect(() => {
    void loadMore(0);
  }, [loadMore]);

  const hasMore = total !== null && cards.length < total;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || failed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore(cards.length);
      },
      { rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, failed, cards.length, loadMore]);

  async function deleteCard(card: BrowseCardRow) {
    if (!confirm("Delete this card? This cannot be undone.")) return;
    setActionError(null);
    try {
      const res = await apiFetch("/api/browse/batch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", card_ids: [card.id] }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCards((prev) => prev.filter((c) => c.id !== card.id));
      setTotal((prev) => (prev === null ? prev : prev - 1));
      setEditing(null);
      invalidateDeckCaches();
      router.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not delete this card.");
    }
  }

  if (failed && cards.length === 0) {
    return <LoadErrorState label="these cards" onRetry={() => void loadMore(0)} />;
  }

  return (
    <>
      {actionError ? <div className="notice notice-error dhd-notice">{actionError}</div> : null}
      <div>
        {cards.map((card) => (
          <CardRow
            key={card.id}
            card={card}
            onEdit={() => setEditing(card)}
            onDelete={() => void deleteCard(card)}
          />
        ))}
        {loading ? <RowsSkeleton rows={cards.length === 0 ? 6 : 2} /> : null}
      </div>
      <div ref={sentinelRef} />
      {failed && cards.length > 0 ? (
        <div className="dhd-more">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadMore(cards.length)}>
            Try again
          </button>
        </div>
      ) : null}

      <CardEditOverlay
        open={Boolean(editing)}
        card={editing as OverlayCard | null}
        onClose={() => setEditing(null)}
        onSaved={(updated) => {
          setCards((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
          setEditing((current) => (current ? { ...current, ...updated } : current));
        }}
        onDelete={editing ? () => deleteCard(editing) : undefined}
      />
    </>
  );
}

function CardRow({
  card,
  onEdit,
  onDelete,
}: {
  card: BrowseCardRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const occlusion = card.type === "image-occlusion";
  const answer = cardAnswerText(card);
  return (
    <div className="dhd-card-row">
      <div className="dhd-card-row__q">
        {occlusion ? (
          cardPreviewText(card)
        ) : (
          <CardContentRenderer
            content={card.type === "cloze" ? card.cloze_text : card.front}
            clozeMode={card.type === "cloze" ? "revealed" : "none"}
          />
        )}
        {card.suspended ? <span className="dh-pill dhd-card-row__tag">Suspended</span> : null}
      </div>
      <div className="dhd-card-row__a">
        {!occlusion && answer ? (
          <CardContentRenderer content={card.type === "cloze" ? card.extra : card.back} clozeMode="none" />
        ) : null}
      </div>
      <RowMenu onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

function RowMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="dhd-row-menu">
      <button
        type="button"
        className="dhd-icon-btn dhd-icon-btn--sm"
        aria-label="Card actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <i className="ri-more-line" aria-hidden />
      </button>
      {open ? (
        <div role="menu" aria-label="Card actions" className="dhd-row-menu__list">
          <button
            type="button"
            role="menuitem"
            className="dh-menu-row"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            <i className="ri-pencil-line" aria-hidden />
            <span>Edit card</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="dh-menu-row dh-menu-row--danger"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <i className="ri-delete-bin-line" aria-hidden />
            <span>Delete card</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="dhd-card-row" aria-hidden>
          <SkeletonBar width="82%" height={13} style={{ marginTop: 4 }} />
          <SkeletonBar width="64%" height={13} style={{ marginTop: 4 }} />
          <span style={{ width: 24 }} />
        </div>
      ))}
    </>
  );
}
