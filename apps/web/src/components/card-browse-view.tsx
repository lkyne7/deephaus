"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  type BrowseCardRow,
  type BrowseFilters,
  cardAnswerText,
  cardPreviewText,
} from "@/lib/browse/cards";
import { CardFieldEditor } from "@/components/card-field-editor";
import { CardTypeBadge } from "@/components/card-type-badge";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
import { type CardType, type ImageOcclusionData } from "@deephaus/shared";
import { CardSaveStatus } from "@/components/card-save-status";
import {
  CardStudyPreviewLauncher,
  type CardStudyPreviewCard,
} from "@/components/card-study-preview";
import { CardTagsEditor, parseTagsInput } from "@/components/card-tags-editor";
import { StudyCardTags } from "@/components/study-card-tags";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { buildCardUpdateBody, cardUpdateSnapshot, updateCardApi } from "@/lib/cards/update";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { SkeletonTableRows } from "@/components/ui/skeleton-patterns";

type DeckOption = { id: string; name: string };

type Props = {
  initialDecks: DeckOption[];
};

const PAGE_SIZE = 50;

function truncate(text: string, max = 120) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function CardBrowseView({ initialDecks }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [decks] = useState(initialDecks);
  const [tags, setTags] = useState<string[]>([]);
  const deckFromUrl = searchParams.get("deck") ?? "";
  const qFromUrl = searchParams.get("q") ?? "";
  const [deckId, setDeckId] = useState<string>(() =>
    deckFromUrl && initialDecks.some((d) => d.id === deckFromUrl) ? deckFromUrl : "",
  );
  const [tag, setTag] = useState<string>("");
  const [search, setSearch] = useState(() => qFromUrl);
  const [debouncedSearch, setDebouncedSearch] = useState(() => qFromUrl.trim());
  const [offset, setOffset] = useState(0);
  const [cards, setCards] = useState<BrowseCardRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<BrowseCardRow>>({});
  const [tagsInput, setTagsInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (deckFromUrl && decks.some((d) => d.id === deckFromUrl)) {
      setDeckId(deckFromUrl);
    }
  }, [deckFromUrl, decks]);

  useEffect(() => {
    setSearch(qFromUrl);
  }, [qFromUrl]);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  useEffect(() => {
    setOffset(0);
    setCheckedIds(new Set());
    setAnchorIndex(null);
  }, [deckId, tag, debouncedSearch]);

  useEffect(() => {
    setCheckedIds(new Set());
    setAnchorIndex(null);
  }, [offset]);

  const loadCards = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (deckId) params.set("deck_id", deckId);
      if (tag) params.set("tag", tag);
      if (debouncedSearch) params.set("q", debouncedSearch);

      const res = await fetch(`/api/browse/cards?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        cards: BrowseCardRow[];
        total: number;
      };
      // Defensive: guarantee unique card ids so React row keys never collide,
      // even if a future query/join or a stale response yields a duplicate row.
      const seen = new Set<string>();
      const uniqueCards = data.cards.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });
      setCards(uniqueCards);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load cards");
    } finally {
      setLoading(false);
    }
  }, [deckId, tag, debouncedSearch, offset]);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  // Tag list is deck-scoped, so it only needs to refresh when the deck changes —
  // not on every keystroke or page, which is what made browse feel sluggish.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams();
        if (deckId) params.set("deck_id", deckId);
        const res = await fetch(`/api/browse/filters?${params}`, { credentials: "include" });
        if (!res.ok) return;
        const data = (await res.json()) as { filters: BrowseFilters | null };
        if (!cancelled && data.filters) setTags(data.filters.tags);
      } catch {
        // Non-fatal: the cards list still works without the tag filter list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  useEffect(() => {
    if (tag && !tags.includes(tag)) setTag("");
  }, [tag, tags]);

  const focused = useMemo(
    () => cards.find((c) => c.id === focusedId) ?? null,
    [cards, focusedId],
  );

  const checkedCards = useMemo(
    () => cards.filter((c) => checkedIds.has(c.id)),
    [cards, checkedIds],
  );

  const actionTargets = useMemo(() => {
    if (checkedIds.size > 0) return checkedCards;
    return focused ? [focused] : [];
  }, [checkedIds.size, checkedCards, focused]);

  const draftFocusIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focusedId) {
      draftFocusIdRef.current = null;
      setDraft({});
      setTagsInput("");
      return;
    }
    const card = cards.find((c) => c.id === focusedId);
    if (!card) return;
    if (draftFocusIdRef.current === focusedId) return;
    draftFocusIdRef.current = focusedId;
    setDraft({
      ...card,
      back: card.type === "basic" ? card.back ?? card.extra : card.back,
      extra: card.type === "basic" ? null : card.extra,
    });
    setTagsInput(card.tags.join(", "));
  }, [focusedId, cards]);

  useEffect(() => {
    if (cards.length === 0) {
      setFocusedId(null);
      return;
    }
    if (!focusedId || !cards.some((c) => c.id === focusedId)) {
      setFocusedId(cards[0].id);
      setAnchorIndex(0);
    }
  }, [cards, focusedId]);

  useEffect(() => {
    if (!focusedId) return;
    rowRefs.current.get(focusedId)?.scrollIntoView({ block: "nearest" });
  }, [focusedId]);

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + cards.length, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;
  const hasActiveFilters = Boolean(deckId || tag || debouncedSearch);

  const clearFilters = useCallback(() => {
    setDeckId("");
    setTag("");
    setSearch("");
    router.replace("/decks");
  }, [router]);
  const allOnPageChecked = cards.length > 0 && cards.every((c) => checkedIds.has(c.id));
  const someOnPageChecked = cards.some((c) => checkedIds.has(c.id));

  const setRowRef = useCallback((id: string, el: HTMLTableRowElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const selectRange = useCallback(
    (from: number, to: number) => {
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      setCheckedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          next.add(cards[i].id);
        }
        return next;
      });
    },
    [cards],
  );

  const handleRowClick = useCallback(
    (card: BrowseCardRow, index: number, event: React.MouseEvent) => {
      setFocusedId(card.id);

      if (event.shiftKey && anchorIndex != null) {
        selectRange(anchorIndex, index);
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        setCheckedIds((prev) => {
          const next = new Set(prev);
          if (next.has(card.id)) next.delete(card.id);
          else next.add(card.id);
          return next;
        });
        setAnchorIndex(index);
        return;
      }

      setCheckedIds(new Set([card.id]));
      setAnchorIndex(index);
    },
    [anchorIndex, selectRange],
  );

  const toggleRowChecked = useCallback((cardId: string, index: number) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
    setAnchorIndex(index);
  }, []);

  const selectAllOnPage = useCallback(() => {
    setCheckedIds(new Set(cards.map((c) => c.id)));
    setAnchorIndex(0);
  }, [cards]);

  const clearSelection = useCallback(() => {
    setCheckedIds(new Set());
    setAnchorIndex(null);
  }, []);

  const moveFocus = useCallback(
    (delta: number) => {
      if (cards.length === 0) return;
      const idx = cards.findIndex((c) => c.id === focusedId);
      const nextIdx = idx < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, idx + delta));
      const nextId = cards[nextIdx].id;
      setFocusedId(nextId);
      setAnchorIndex(nextIdx);
      setCheckedIds((prev) => (prev.size > 1 ? prev : new Set([nextId])));
    },
    [cards, focusedId],
  );

  async function runBatch(action: "suspend" | "unsuspend" | "delete") {
    const ids = actionTargets.map((c) => c.id);
    if (ids.length === 0) return;

    if (action === "delete") {
      const noun = ids.length === 1 ? "this card" : `${ids.length} cards`;
      if (!confirm(`Delete ${noun}? This cannot be undone.`)) return;
    }

    setBatchBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/browse/batch", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, card_ids: ids }),
      });
      if (!res.ok) throw new Error(await res.text());
      clearSelection();
      await loadCards();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch action failed");
    } finally {
      setBatchBusy(false);
    }
  }

  async function toggleSuspendForTargets() {
    if (actionTargets.length === 0) return;
    const allSuspended = actionTargets.every((c) => c.suspended);
    await runBatch(allSuspended ? "unsuspend" : "suspend");
  }

  const parsedTags = useMemo(() => parseTagsInput(tagsInput), [tagsInput]);

  const previewCard = useMemo((): CardStudyPreviewCard | null => {
    if (!focused) return null;
    const type = (draft.type ?? focused.type) as CardStudyPreviewCard["type"];
    return {
      type,
      front: type === "cloze" ? null : (draft.front ?? focused.front ?? null),
      back: type === "basic" ? (draft.back ?? focused.back ?? null) : (draft.back ?? focused.back ?? null),
      cloze_text: type === "cloze" ? (draft.cloze_text ?? focused.cloze_text ?? null) : null,
      extra: type === "basic" ? null : (draft.extra ?? focused.extra ?? null),
      occlusion_data:
        type === "image-occlusion"
          ? ((draft.occlusion_data as ImageOcclusionData | undefined) ??
            focused.occlusion_data ??
            null)
          : undefined,
      tags: parsedTags,
    };
  }, [focused, draft, parsedTags]);

  const saveSnapshot = useMemo(() => {
    if (!focused) return "";
    const cardType = (draft.type ?? focused.type) as "basic" | "cloze" | "image-occlusion";
    return cardUpdateSnapshot({
      type: cardType,
      front: draft.front ?? focused.front,
      back: draft.back ?? focused.back,
      cloze_text: draft.cloze_text ?? focused.cloze_text,
      extra: draft.extra ?? focused.extra,
      occlusion_data:
        (draft.occlusion_data as ImageOcclusionData | undefined) ??
        (focused.occlusion_data as ImageOcclusionData | undefined) ??
        null,
      tags: parsedTags,
    });
  }, [focused, draft, parsedTags]);

  const persistFocusedCard = useCallback(async () => {
    if (!focused) return;
    const cardType = (draft.type ?? focused.type) as "basic" | "cloze" | "image-occlusion";
    const body = buildCardUpdateBody({
      type: cardType,
      front: draft.front ?? focused.front,
      back: draft.back ?? focused.back,
      cloze_text: draft.cloze_text ?? focused.cloze_text,
      extra: draft.extra ?? focused.extra,
      occlusion_data:
        (draft.occlusion_data as ImageOcclusionData | undefined) ??
        (focused.occlusion_data as ImageOcclusionData | undefined) ??
        null,
      tags: parsedTags,
    });
    const saved = await updateCardApi<BrowseCardRow>(focused.id, body);
    setCards((prev) =>
      prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)),
    );
  }, [focused, draft, parsedTags]);

  const { status: saveStatus, error: saveError } = useAutoSaveCard({
    cardId: focused?.id ?? null,
    snapshot: saveSnapshot,
    // Only auto-save once the draft belongs to the focused card. On a card switch
    // the focused id updates one render before the draft does; gating here avoids
    // saving a stale/mismatched snapshot back to the newly focused card.
    enabled:
      Boolean(focused) &&
      draft.id === focusedId &&
      checkedIds.size <= 1 &&
      !batchBusy,
    save: persistFocusedCard,
  });

  async function toggleSuspendSingle(next: boolean) {
    if (!focused) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/cards/${focused.id}/suspend`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspended: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      setCards((prev) =>
        prev.map((c) => (c.id === focused.id ? { ...c, suspended: next } : c)),
      );
      setDraft((d) => ({ ...d, suspended: next }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update suspend state");
    } finally {
      setSaving(false);
    }
  }

  function handleListKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (isEditableTarget(e.target) && e.key !== "Escape") return;

    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === "a") {
      e.preventDefault();
      selectAllOnPage();
      return;
    }

    if (mod && e.key.toLowerCase() === "j") {
      e.preventDefault();
      void toggleSuspendForTargets();
      return;
    }

    if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      void runBatch("delete");
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      clearSelection();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(1);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(-1);
      return;
    }

    if (e.key === " " && !mod) {
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      const idx = cards.findIndex((c) => c.id === focusedId);
      if (idx >= 0 && focusedId) toggleRowChecked(focusedId, idx);
    }
  }

  return (
    <div style={s.shell}>
      <div style={s.toolbar}>
        <div style={s.toolbarMain}>
          <input
            type="search"
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cards…"
            style={s.searchField}
            aria-label="Search cards"
          />
          <select
            className="input"
            value={deckId}
            onChange={(e) => setDeckId(e.target.value)}
            style={s.filterSelect}
            aria-label="Deck"
          >
            <option value="">All decks</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            className="input"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            style={s.filterSelect}
            aria-label="Tag"
            disabled={tags.length === 0}
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {hasActiveFilters ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={clearFilters}
              aria-label="Clear all filters"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      {checkedIds.size > 1 && (
        <div style={s.batchBar}>
          <span style={s.batchLabel}>{checkedIds.size} selected</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={batchBusy}
            onClick={() => void runBatch("suspend")}
          >
            Suspend
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={batchBusy}
            onClick={() => void runBatch("unsuspend")}
          >
            Unsuspend
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={batchBusy}
            onClick={() => void runBatch("delete")}
          >
            Delete
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearSelection}>
            Clear
          </button>
        </div>
      )}

      {error && (
        <div style={s.errorBanner}>
          <i className="ri-error-warning-line" />
          {error}
        </div>
      )}

      <div style={s.split}>
        <div
          ref={listRef}
          style={s.listPane}
          tabIndex={0}
          onKeyDown={handleListKeyDown}
          aria-label="Card list"
          title="↑↓ move · ⌘A select all · ⌘J suspend · Space toggle · Del delete"
        >
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={{ ...s.th, width: 36 }}>
                    <input
                      type="checkbox"
                      aria-label="Select all on page"
                      checked={allOnPageChecked}
                      ref={(el) => {
                        if (el) el.indeterminate = someOnPageChecked && !allOnPageChecked;
                      }}
                      onChange={(e) => {
                        if (e.target.checked) selectAllOnPage();
                        else clearSelection();
                      }}
                    />
                  </th>
                  <th style={s.th}>Front</th>
                  <th style={s.th}>Back</th>
                  <th style={{ ...s.th, width: 180 }}>Tags</th>
                </tr>
              </thead>
              <tbody>
                {loading && cards.length === 0 ? (
                  <SkeletonTableRows rows={12} columns={4} />
                ) : cards.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={s.emptyCell}>
                      No cards match your filters.
                    </td>
                  </tr>
                ) : (
                  cards.map((card, index) => {
                    const active = card.id === focusedId;
                    const checked = checkedIds.has(card.id);
                    return (
                      <tr
                        key={card.id}
                        ref={(el) => setRowRef(card.id, el)}
                        style={{
                          ...s.tr,
                          ...(active ? s.trActive : {}),
                          ...(checked ? s.trChecked : {}),
                          ...(card.suspended ? s.trSuspended : {}),
                        }}
                        onClick={(e) => handleRowClick(card, index, e)}
                      >
                        <td
                          style={s.tdCheck}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleRowChecked(card.id, index);
                            setFocusedId(card.id);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            aria-label={`Select ${cardPreviewText(card) || "card"}`}
                            onChange={() => toggleRowChecked(card.id, index)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td style={s.td}>
                          <div style={s.cellMain}>{truncate(cardPreviewText(card)) || "—"}</div>
                          <div style={s.cellSub}>{card.deck_name}</div>
                        </td>
                        <td style={s.td}>{truncate(cardAnswerText(card)) || "—"}</td>
                        <td style={s.td}>
                          {card.tags.length === 0 ? (
                            <span style={s.muted}>—</span>
                          ) : (
                            <StudyCardTags tags={card.tags} align="start" />
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div style={s.footer}>
            <span style={s.resultCount}>
              {loading && cards.length === 0 ? (
                <SkeletonBar width={140} height={12} />
              ) : total === 0
                  ? "No cards"
                  : `${pageStart.toLocaleString()}–${pageEnd.toLocaleString()} of ${total.toLocaleString()}`}
            </span>
            <div style={s.pager}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!canPrev || loading}
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                aria-label="Previous page"
              >
                Previous
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!canNext || loading}
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                aria-label="Next page"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <aside style={s.editorPane}>
          {!focused ? (
            <div style={s.editorEmpty}>Select a card to edit</div>
          ) : (
            <>
              <div style={s.editorScroll}>
              <div style={s.editorHeader}>
                <div style={s.editorHeaderTop}>
                  <div style={s.editorHeading}>
                    <div style={s.editorTitle}>
                      {focused.deck_name}
                      {checkedIds.size > 1 ? ` · ${checkedIds.size} selected` : ""}
                    </div>
                    <CardTypeBadge
                      type={(draft.type ?? focused.type) as CardType}
                    />
                  </div>
                  {previewCard ? (
                    <CardStudyPreviewLauncher
                      key={focused.id}
                      card={previewCard}
                      disabled={batchBusy}
                      compact
                    />
                  ) : null}
                </div>
              </div>

              {(() => {
                const editorCardType = (draft.type ?? focused.type) as
                  | "basic"
                  | "cloze"
                  | "image-occlusion";
                if (editorCardType === "image-occlusion") {
                  return (
                    <ImageOcclusionCardSection
                      key={focused.id}
                      cardId={focused.id}
                      front={draft.front ?? focused.front ?? ""}
                      back={draft.back ?? focused.back ?? ""}
                      occlusionData={
                        draft.occlusion_data ?? focused.occlusion_data ?? null
                      }
                      disabled={batchBusy}
                      onChange={(patch) =>
                        setDraft((d) => ({
                          ...d,
                          type: patch.type,
                          front: patch.front,
                          back: patch.back,
                          occlusion_data: patch.occlusion_data,
                          cloze_text: null,
                          extra: null,
                        }))
                      }
                    />
                  );
                }
                return (
                  <>
                    <CardFieldEditor
                      key={`${focused.id}-front`}
                      label="Front"
                      cardId={focused.id}
                      allowCloze={editorCardType === "cloze"}
                      value={
                        editorCardType === "cloze"
                          ? (draft.cloze_text ?? focused.cloze_text ?? "")
                          : (draft.front ?? focused.front ?? "")
                      }
                      onChange={(v) =>
                        setDraft((d) =>
                          editorCardType === "cloze"
                            ? { ...d, cloze_text: v }
                            : { ...d, front: v },
                        )
                      }
                      placeholder={
                        editorCardType === "cloze"
                          ? "Cloze text — select text and use C or C1/C2/C3"
                          : "Question"
                      }
                      disabled={batchBusy}
                    />
                    <CardFieldEditor
                      key={`${focused.id}-back`}
                      label="Back"
                      cardId={focused.id}
                      value={
                        editorCardType === "cloze"
                          ? (draft.extra ?? focused.extra ?? "")
                          : (draft.back ?? draft.extra ?? focused.back ?? focused.extra ?? "")
                      }
                      onChange={(v) =>
                        setDraft((d) =>
                          editorCardType === "cloze"
                            ? { ...d, extra: v }
                            : { ...d, back: v, extra: null },
                        )
                      }
                      placeholder={
                        editorCardType === "cloze" ? "Answer shown on reveal" : "Answer"
                      }
                      disabled={batchBusy}
                    />
                  </>
                );
              })()}

              <CardTagsEditor
                key={focused.id}
                value={tagsInput}
                onChange={setTagsInput}
                disabled={batchBusy}
              />
              </div>

              <div style={s.editorActions}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={batchBusy || actionTargets.length === 0}
                  onClick={() => void runBatch("delete")}
                >
                  <i className="ri-delete-bin-line" />
                  Delete{checkedIds.size > 1 ? ` (${checkedIds.size})` : ""}
                </button>
                <div style={s.editorFooterMeta}>
                  <CardSaveStatus status={saveStatus} error={saveError} />
                  <SuspendStatusToggle
                    suspended={Boolean(draft.suspended ?? focused.suspended)}
                    disabled={saving || batchBusy}
                    onChange={(next) => void toggleSuspendSingle(next)}
                  />
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function SuspendStatusToggle({
  suspended,
  disabled,
  onChange,
}: {
  suspended: boolean;
  disabled?: boolean;
  onChange: (suspended: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={suspended ? "chip chip-due" : "chip chip-new"}
      style={s.suspendStatusBtn}
      onClick={() => onChange(!suspended)}
      aria-pressed={suspended}
      aria-label={
        suspended
          ? "Suspended — click to activate this card"
          : "Active — click to suspend this card"
      }
      title={suspended ? "Click to activate" : "Click to suspend"}
    >
      <i
        className={suspended ? "ri-pause-circle-fill" : "ri-play-circle-fill"}
        style={s.suspendStatusIcon}
        aria-hidden
      />
      {suspended ? "Suspended" : "Active"}
    </button>
  );
}

const s: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    height: "calc(100vh - var(--app-chrome-height))",
    padding: "16px 24px 20px",
    boxSizing: "border-box",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  toolbarMain: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
    flexWrap: "wrap",
  },
  searchField: {
    flex: "1 1 280px",
    minWidth: 200,
    maxWidth: 480,
  },
  filterSelect: {
    flex: "0 1 auto",
    minWidth: 130,
    maxWidth: 200,
    width: "auto",
  },
  batchBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 8,
    background: "var(--brand-25)",
    border: "1px solid var(--brand-100)",
  },
  batchLabel: {
    font: "500 13px/20px var(--font-sans)",
    color: "var(--ink-700)",
    marginRight: 4,
  },
  errorBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--orange-50)",
    color: "var(--orange-700)",
    font: "400 14px/20px var(--font-sans)",
  },
  split: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 380px",
    gridTemplateRows: "minmax(0, 1fr)",
    gap: 16,
    flex: 1,
    minHeight: 0,
    alignItems: "stretch",
  },
  listPane: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    height: "100%",
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    overflow: "hidden",
    outline: "none",
  },
  tableWrap: {
    flex: 1,
    overflow: "auto",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    font: "400 13px/18px var(--font-sans)",
  },
  th: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    textAlign: "left",
    font: "500 11px/1 var(--font-sans)",
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--fg-4)",
    padding: "12px 16px",
    background: "var(--paper-soft)",
    borderBottom: "1px solid var(--border-1)",
  },
  tr: {
    cursor: "pointer",
    borderBottom: "1px solid var(--border-1)",
  },
  trActive: {
    background: "var(--brand-25)",
  },
  trChecked: {
    background: "var(--brand-50)",
  },
  trSuspended: {
    background: "var(--orange-25)",
    boxShadow: "inset 3px 0 0 var(--orange-400)",
  },
  td: {
    padding: "12px 16px",
    verticalAlign: "top",
    color: "var(--ink-700)",
  },
  tdCheck: {
    padding: "12px 8px 12px 16px",
    verticalAlign: "top",
    width: 36,
  },
  cellMain: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--ink-900)",
  },
  cellSub: {
    marginTop: 4,
    font: "400 11px/14px var(--font-sans)",
    color: "var(--fg-4)",
  },
  tagRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  emptyCell: {
    padding: "48px 16px",
    textAlign: "center",
    color: "var(--fg-4)",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 16px",
    borderTop: "1px solid var(--border-1)",
    background: "var(--paper-soft)",
  },
  resultCount: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--fg-secondary)",
  },
  pager: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  muted: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  editorPane: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    height: "100%",
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    overflow: "hidden",
  },
  editorScroll: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 16,
  },
  editorEmpty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    color: "var(--fg-4)",
    font: "400 14px/20px var(--font-sans)",
    textAlign: "center",
  },
  editorHeader: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  editorHeaderTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  editorHeading: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "flex-start",
  },
  editorTitle: {
    minWidth: 0,
    maxWidth: "100%",
    font: "600 15px/20px var(--font-sans)",
    color: "var(--ink-900)",
  },
  suspendStatusBtn: {
    border: "1px solid transparent",
    cursor: "pointer",
    font: "600 12px/16px var(--font-sans)",
    padding: "4px 10px",
    transition: "opacity 0.15s ease, box-shadow 0.15s ease",
  },
  suspendStatusIcon: {
    fontSize: 14,
    lineHeight: 1,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  fieldLabel: {
    font: "500 11px/1 var(--font-sans)",
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--fg-4)",
  },
  input: {
    font: "400 14px/20px var(--font-sans)",
    color: "var(--ink-700)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    padding: "10px 12px",
    background: "var(--white)",
  },
  editorActions: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 16px",
    borderTop: "1px solid var(--border-1)",
    background: "var(--paper-soft)",
  },
  editorFooterMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  },
};
