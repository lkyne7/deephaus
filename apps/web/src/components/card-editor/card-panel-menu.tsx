"use client";

import { useEffect, useRef, useState } from "react";
import { REWRITE_COPY, type RewriteAction } from "@/components/card-editor/card-rewrite";
import "@/components/workbench/workbench.css";

type Props = {
  disabled?: boolean;
  /** Mnemonic / Regenerate; omitted for card types that don't support them. */
  rewrite?: {
    rewriting: RewriteAction | null;
    run: (action: RewriteAction) => void;
  };
  onDelete?: () => void;
};

/** The card editor's ··· menu: the one-click rewrites and Delete. */
export function CardPanelMenu({ disabled, rewrite, onDelete }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // Close the menu, not the panel around it.
      e.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (!rewrite && !onDelete) return null;
  const busy = rewrite?.rewriting ?? null;

  return (
    // While open, keys belong to the menu, not the Study page's shortcuts.
    <div ref={rootRef} className="dh-bench-menu" data-study-keys={open ? "ignore" : undefined}>
      <button
        type="button"
        className="dh-bench-iconbtn"
        aria-label={busy ? REWRITE_COPY[busy].busyLabel : "More card actions"}
        title={busy ? REWRITE_COPY[busy].busyLabel : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <i className={busy ? "ri-loader-4-line icon-spin" : "ri-more-line"} aria-hidden />
      </button>
      {open ? (
        <div className="dh-bench-menu__list dh-card-menu" role="menu" aria-label="Card actions">
          {rewrite
            ? (["mnemonic", "regenerate"] as const).map((action) => (
                <button
                  key={action}
                  type="button"
                  role="menuitem"
                  className="dh-menu-row"
                  title={REWRITE_COPY[action].title}
                  disabled={busy !== null}
                  onClick={() => {
                    setOpen(false);
                    rewrite.run(action);
                  }}
                >
                  <i className={REWRITE_COPY[action].icon} aria-hidden />
                  {REWRITE_COPY[action].label}
                </button>
              ))
            : null}
          {rewrite && onDelete ? <div className="dh-menu-sep" role="separator" /> : null}
          {onDelete ? (
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
              Delete card
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
