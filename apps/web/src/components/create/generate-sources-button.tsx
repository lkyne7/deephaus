"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DeckSource } from "@/lib/sources/deck-sources";
import { sourceTypeIconClass } from "@/lib/sources/file-types";

type Props = {
  sources: DeckSource[];
  activeSourceId: string | null;
  disabled?: boolean;
  generating?: boolean;
  disabledReason?: string;
  onGenerate: (sources: DeckSource[]) => void;
};

function usageLabel(source: DeckSource): string {
  if (source.cardCount === 0) return "Not used yet";
  return `${source.cardCount} ${source.cardCount === 1 ? "card" : "cards"}`;
}

/**
 * Generate action for the Sources tab. With several sources it asks which to
 * use, starting from the ones that haven't produced cards yet.
 */
export function GenerateSourcesButton({
  sources,
  activeSourceId,
  disabled,
  generating,
  disabledReason,
  onGenerate,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  const unused = useMemo(() => sources.filter((source) => source.cardCount === 0), [sources]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const only = sources.length === 1 ? sources[0]! : null;

  function openPicker() {
    const defaults = unused.length > 0 ? unused.map((source) => source.id) : [activeSourceId ?? ""];
    setPicked(new Set(defaults.filter(Boolean)));
    setOpen(true);
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const label = generating
    ? "Generating…"
    : only
      ? only.cardCount > 0
        ? "Generate more cards"
        : "Generate cards"
      : "Generate cards";

  return (
    <div ref={rootRef} className="dhc-menu-root">
      <button
        type="button"
        className="create-topbar-control create-topbar-control--primary"
        disabled={disabled}
        aria-haspopup={only ? undefined : "dialog"}
        aria-expanded={only ? undefined : open}
        title={disabledReason}
        onClick={() => {
          if (only) onGenerate([only]);
          else if (open) setOpen(false);
          else openPicker();
        }}
      >
        <i className="create-topbar-control__icon ri-sparkling-2-line" aria-hidden />
        {label}
        {only ? null : <i className="ri-arrow-down-s-line create-topbar-control__caret" aria-hidden />}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose sources to generate from"
          className="dhc-menu dhc-menu--down dhc-menu--right"
          style={{ width: 340 }}
        >
          <div className="dhc-settings__label">Generate from</div>
          <div className="dhc-menu__list">
            {sources.map((source) => {
              const selected = picked.has(source.id);
              return (
                <button
                  key={source.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  className="dh-menu-item"
                  onClick={() => toggle(source.id)}
                >
                  <i
                    className={`${sourceTypeIconClass(source.type)} dh-menu-item__icon`}
                    aria-hidden
                  />
                  <span className="dhc-menu__text">
                    <span className="dh-menu-item__label">{source.title}</span>
                    <span className="dhc-menu__desc">{usageLabel(source)}</span>
                  </span>
                  <span className={`dhc-check${selected ? " dhc-check--on" : ""}`} aria-hidden>
                    {selected ? <i className="ri-check-line" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="dhc-menu__sep" />
          <p className="dhc-menu__note">Questions already in this deck are skipped.</p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={picked.size === 0}
            onClick={() => {
              setOpen(false);
              onGenerate(sources.filter((source) => picked.has(source.id)));
            }}
          >
            {picked.size === 1 ? "Generate from 1 source" : `Generate from ${picked.size} sources`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
