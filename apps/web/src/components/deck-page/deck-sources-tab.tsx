"use client";

import Link from "next/link";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { cardCountLabel } from "@/lib/decks/deck-list";
import type { DeckSourceListItem } from "@/app/api/projects/[id]/sources/route";

const SOURCE_ICONS: Record<string, string> = {
  text: "ri-file-text-line",
  youtube: "ri-youtube-line",
  notion: "ri-notion-line",
  video: "ri-video-line",
  xlsx: "ri-file-excel-line",
  website: "ri-global-line",
};

function addedLabel(iso: string) {
  return `Added ${new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function DeckSourcesTab({
  deckId,
  sources,
  failed,
  onRetry,
}: {
  deckId: string;
  sources: DeckSourceListItem[] | null;
  failed: boolean;
  onRetry: () => void;
}) {
  if (failed) return <LoadErrorState label="these sources" onRetry={onRetry} />;
  if (!sources) return null;
  if (sources.length === 0) {
    return (
      <div className="dh-empty">
        <h2>No sources yet</h2>
        <p>Add a document, link, or notes to make cards from them.</p>
        <Link href={`/create?deck=${deckId}`} className="btn btn-secondary btn-sm">
          Add a source
        </Link>
      </div>
    );
  }
  return (
    <div className="dhd-sources">
      {sources.map((source) => (
        <Link key={source.id} href={`/create?deck=${deckId}&source=${source.id}`} className="dh-row">
          <i className={`${SOURCE_ICONS[source.type] ?? "ri-file-line"} dhd-sources__icon`} aria-hidden />
          <span className="dhd-sources__main">
            <span className="dhd-sources__title">{source.title}</span>
            <span className="dhd-muted">
              {[
                cardCountLabel(source.cardCount),
                source.pageCount ? `${source.pageCount} ${source.pageCount === 1 ? "page" : "pages"}` : null,
                addedLabel(source.createdAt),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <i className="ri-arrow-right-s-line dhd-sources__go" aria-hidden />
        </Link>
      ))}
    </div>
  );
}
