"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { cardCountLabel, type DeckListRow } from "@/lib/decks/deck-list";

/** The deck the others fold into: the biggest, so the least has to move. */
export function mergeKeeper(rows: DeckListRow[]): DeckListRow | null {
  if (rows.length === 0) return null;
  return rows.reduce((keep, row) => (row.total > keep.total ? row : keep), rows[0]);
}

export function mergeBlockedReason(rows: DeckListRow[]): string | null {
  if (rows.some((row) => row.isCommunity || row.isPublished)) {
    return "Published decks and decks from Community can't be merged.";
  }
  return null;
}

/** The side panel while several decks are selected. */
export function DeckBulkPanel({
  rows,
  busy,
  nameInputRef,
  onClear,
  onMerge,
}: {
  rows: DeckListRow[];
  busy: boolean;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  onClear: () => void;
  onMerge: (name: string) => void;
}) {
  const nameId = useId();
  const keeper = mergeKeeper(rows);
  const [name, setName] = useState(keeper?.title ?? "");
  const keeperId = keeper?.id;

  // A different set of decks suggests a different name.
  useEffect(() => {
    setName(keeper?.title ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keeperId]);

  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const due = rows.reduce((sum, row) => sum + row.dueCount, 0);
  const fresh = rows.reduce((sum, row) => sum + row.newCount, 0);
  const studyNow = rows.reduce((sum, row) => sum + (row.paused ? 0 : row.dueCount + row.newCount), 0);
  const blocked = mergeBlockedReason(rows);
  const studyHref = `/review?decks=${rows.map((row) => row.id).join(",")}`;

  return (
    <aside className="dh-panel dh-panel--float dh-bench-panel dhk-panel" aria-label="Selected decks">
      <div className="dh-panel__head dh-bench-panel__head">
        <b className="dh-bench-panel__title">{rows.length} decks selected</b>
        <span className="dh-spacer" />
        <button type="button" className="dh-bench-iconbtn" aria-label="Clear selection" onClick={onClear}>
          <i className="ri-close-line" aria-hidden />
        </button>
      </div>

      <div className="dh-panel__body dhk-panel__body">
        <section>
          <p className="dhk-panel__meta">
            {cardCountLabel(total)} · {due.toLocaleString()} due · {fresh.toLocaleString()} new
          </p>
          <div className="dhk-picked">
            {rows.map((row) => (
              <div key={row.id} className="dhk-picked__row">
                <span className="dhk-picked__title">{row.title}</span>
                <span className="dhk-picked__count">{cardCountLabel(row.total)}</span>
              </div>
            ))}
          </div>
        </section>

        {studyNow > 0 ? (
          <Link href={studyHref} className="btn btn-primary dhk-panel__study">
            Study {cardCountLabel(studyNow)} together
          </Link>
        ) : (
          <button type="button" className="btn btn-primary dhk-panel__study" disabled>
            Nothing to study in these decks
          </button>
        )}

        <section className="dhk-merge">
          <div>
            <p className="dhk-merge__title">Merge into one deck</p>
            <p className="dhk-merge__body">
              Their sources and cards move into one deck. Review history is kept.
            </p>
          </div>
          {blocked ? (
            <p className="dhk-panel__hint">{blocked}</p>
          ) : (
            <>
              <div>
                <label className="dhk-merge__label" htmlFor={nameId}>
                  Name
                </label>
                <input
                  id={nameId}
                  ref={nameInputRef}
                  className="input dhk-merge__input"
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary dhk-merge__go"
                disabled={busy || !name.trim()}
                onClick={() => onMerge(name.trim())}
              >
                Merge {rows.length} decks
              </button>
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
