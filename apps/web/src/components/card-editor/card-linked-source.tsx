"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CardSourceLocation } from "@deephaus/shared";
import { unlinkCardFromSourceApi } from "@/lib/cards/update";
import { formatSegmentLabel } from "@/lib/sources/chunks";

function truncate(text: string, max = 200): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

type SourceLookup = CardSourceLocation & { quote?: string | null };

/** Chunk text without its `--- Page 9 ---` / timestamp markers (the ref line says where). */
function chunkExcerpt(content: string | null | undefined): string {
  return (content ?? "").replace(/---[^\n]*?---/g, " ").replace(/\s+/g, " ").trim();
}

type Props = {
  cardId: string;
  /** The card's own verbatim evidence quote (preferred over the chunk text). */
  quote?: string | null;
  sourceRef?: string | null;
  /** Jump to the passage on this page (the Create page's Sources tab). */
  onViewSource?: (target: { sourceId: string; snippet: string }) => void;
  /** Elsewhere: the deck, so "View in source" can open the passage on the Create page. */
  deckId?: string | null;
  /** Show an Unlink action (Create page). */
  allowUnlink?: boolean;
  onUnlinked?: () => void;
};

/**
 * The passage a card was written from, under the card's fields in every card
 * editor: a quiet quote with a way back to the source.
 */
export function CardLinkedSource({
  cardId,
  quote,
  sourceRef,
  onViewSource,
  deckId,
  allowUnlink,
  onUnlinked,
}: Props) {
  const [data, setData] = useState<SourceLookup | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  /** Hide immediately after a successful unlink so the section doesn't flash. */
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setCleared(false);
    setUnlinkError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/cards/${cardId}/source?image=0`, { credentials: "include" });
        if (res.ok) {
          const json = (await res.json()) as SourceLookup;
          if (!cancelled) setData(json);
        }
      } catch {
        // Best-effort; no linked source on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  // Prefer the card's exact evidence quote; fall back to the chunk excerpt.
  const snippet = (quote ?? "").trim() || (data?.quote ?? "").trim() || chunkExcerpt(data?.content);
  const ref = (sourceRef ?? "").trim() ? formatSegmentLabel(sourceRef!) : data?.label;
  const hasLink = Boolean(snippet || ref);

  if (cleared || !hasLink) return null;

  async function handleUnlink() {
    if (unlinking) return;
    setUnlinking(true);
    setUnlinkError(null);
    try {
      await unlinkCardFromSourceApi(cardId);
      setCleared(true);
      onUnlinked?.();
    } catch (err) {
      setUnlinkError(err instanceof Error ? err.message : "Could not unlink from source.");
    } finally {
      setUnlinking(false);
    }
  }

  const sourceId = data?.sourceId;
  let view: React.ReactNode = null;
  if (sourceId && onViewSource) {
    view = (
      <button type="button" onClick={() => onViewSource({ sourceId, snippet })}>
        View in source
        <i className="ri-arrow-right-up-line" aria-hidden />
      </button>
    );
  } else if (sourceId && deckId && snippet) {
    view = (
      <Link href={`/create?deck=${deckId}&source=${sourceId}&card=${cardId}`}>
        View in source
        <i className="ri-arrow-right-up-line" aria-hidden />
      </Link>
    );
  } else if (data?.externalUrl) {
    view = (
      <a href={data.externalUrl} target="_blank" rel="noopener noreferrer">
        Open original
        <i className="ri-external-link-line" aria-hidden />
      </a>
    );
  }

  return (
    <section className="dh-card-source" aria-label="Linked source">
      <div className="dh-card-source__head">
        <span className="dh-card-source__label">Source</span>
        <span className="dh-spacer" />
        {view}
        {allowUnlink ? (
          <button
            type="button"
            onClick={() => void handleUnlink()}
            disabled={unlinking}
            title="Remove the link between this card and the source passage"
          >
            <i className={unlinking ? "ri-loader-4-line icon-spin" : "ri-link-unlink"} aria-hidden />
            {unlinking ? "Unlinking…" : "Unlink"}
          </button>
        ) : null}
      </div>
      {ref ? <div className="dh-card-source__ref">{ref}</div> : null}
      {snippet ? <blockquote className="dh-card-source__quote">{truncate(snippet, 240)}</blockquote> : null}
      {unlinkError ? <p className="dh-card-source__error">{unlinkError}</p> : null}
    </section>
  );
}
