"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { sourceTypeIconClass, sourceTypeLabel } from "@/lib/sources/file-types";
import type { DeckSource } from "@/lib/sources/deck-sources";

/** Hover-open delay keeps quick mouse passes from flashing the panel. */
const OPEN_DELAY_MS = 120;
/** Grace period so the pointer can travel from the button into the panel. */
const CLOSE_DELAY_MS = 180;

type Props = {
  sources: DeckSource[];
  activeSourceId: string | null;
  disabled?: boolean;
  onSelect: (sourceId: string) => void;
  onAddSource: () => void;
  /** Delete a source after the user confirms. Must not delete flashcards. */
  onDeleteSource: (sourceId: string) => Promise<void>;
};

/**
 * Sources dropdown at the top-left of the source pane. Hovering peeks the
 * list; clicking pins it open (like the deck switcher). Rows switch the
 * active source, and each row exposes a confirm-guarded delete.
 */
export function SourcesFlyout({
  sources,
  activeSourceId,
  disabled,
  onSelect,
  onAddSource,
  onDeleteSource,
}: Props) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  /** True once opened by click — hover-away no longer closes the panel. */
  const [pinned, setPinned] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DeckSource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const open = pos != null;

  const clearTimers = useCallback(() => {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const openNow = useCallback(() => {
    clearTimers();
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      top: rect.bottom + 6,
      left: rect.left,
      maxHeight: Math.max(180, window.innerHeight - rect.bottom - 18),
    });
  }, [clearTimers]);

  const close = useCallback(() => {
    clearTimers();
    setPos(null);
    setPinned(false);
  }, [clearTimers]);

  const scheduleOpen = useCallback(() => {
    clearTimers();
    openTimer.current = window.setTimeout(openNow, OPEN_DELAY_MS);
  }, [clearTimers, openNow]);

  const scheduleClose = useCallback(() => {
    clearTimers();
    if (pinned) return;
    closeTimer.current = window.setTimeout(() => setPos(null), CLOSE_DELAY_MS);
  }, [clearTimers, pinned]);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  async function confirmDelete() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteSource(pendingDelete.id);
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete the source.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`create-sources-flyout__btn${open ? " create-sources-flyout__btn--open" : ""}`}
        aria-label="Sources"
        title="Sources"
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseEnter={() => {
          if (!open) scheduleOpen();
        }}
        onMouseLeave={scheduleClose}
        onClick={() => {
          if (open && pinned) {
            close();
            return;
          }
          openNow();
          setPinned(true);
        }}
      >
        <i className="ri-book-open-line" aria-hidden />
        <i
          className={`${open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} create-sources-flyout__caret`}
          aria-hidden
        />
      </button>

      {pos
        ? createPortal(
            <div
              ref={panelRef}
              className="create-sources-flyout"
              role="menu"
              aria-label="Sources"
              style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
              onMouseEnter={clearTimers}
              onMouseLeave={scheduleClose}
            >
              <div className="create-sources-flyout__title">Sources</div>
              <button
                type="button"
                role="menuitem"
                className="dh-menu-item"
                disabled={disabled}
                onClick={() => {
                  close();
                  onAddSource();
                }}
              >
                <i className="ri-add-line dh-menu-item__icon" aria-hidden />
                <span className="dh-menu-item__label">Add source</span>
              </button>

              {sources.length > 0 ? (
                <>
                  <div className="create-sources-flyout__divider" />
                  <div className="create-sources-flyout__list">
                    {sources.map((source) => {
                      const active = source.id === activeSourceId;
                      return (
                        <div key={source.id} className="create-sources-flyout__row" role="none">
                          <button
                            type="button"
                            role="menuitem"
                            className={`dh-menu-item${active ? " is-active" : ""}`}
                            onClick={() => {
                              close();
                              onSelect(source.id);
                            }}
                          >
                            <i
                              className={`${sourceTypeIconClass(source.type)} dh-menu-item__icon`}
                              aria-hidden
                              title={sourceTypeLabel(source.type)}
                            />
                            <span className="dh-menu-item__label">{source.title}</span>
                            {active ? (
                              <i className="ri-check-line dh-menu-item__check" aria-hidden />
                            ) : null}
                          </button>
                          <button
                            type="button"
                            className="create-sources-flyout__delete"
                            disabled={disabled || deleting}
                            aria-label={`Delete ${source.title}`}
                            title="Delete source"
                            onClick={() => {
                              close();
                              setDeleteError(null);
                              setPendingDelete(source);
                            }}
                          >
                            <i className="ri-delete-bin-line" aria-hidden />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="create-sources-flyout__empty">Saved sources appear here.</p>
              )}
            </div>,
            document.body,
          )
        : null}

      {pendingDelete ? (
        <AnimatedModal
          title="Delete source?"
          onClose={deleting ? () => undefined : () => setPendingDelete(null)}
          maxWidth={420}
        >
          <div className="create-sources-flyout__confirm">
            <p className="create-sources-flyout__confirm-text">
              Delete <strong>{pendingDelete.title}</strong>? Your flashcards stay in this deck.
              Links from those cards back to this source will be removed.
            </p>
            {deleteError ? (
              <div className="create-sources-flyout__confirm-error" role="alert">
                {deleteError}
              </div>
            ) : null}
            <div className="create-sources-flyout__confirm-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void confirmDelete()}
                disabled={deleting}
              >
                {deleting ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
                Delete source
              </button>
            </div>
          </div>
        </AnimatedModal>
      ) : null}
    </>
  );
}
