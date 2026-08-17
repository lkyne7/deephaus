"use client";

import { useState } from "react";
import { m, useReducedMotion } from "motion/react";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { RailHoverTip } from "@/components/ui/rail-hover-tip";
import { SidebarPanelIcon } from "@/components/ui/sidebar-panel-icon";
import { motionTokens, motionTransition } from "@/lib/motion";
import { sourceTypeIconClass, sourceTypeLabel } from "@/lib/sources/file-types";
import type { DeckSource } from "@/lib/sources/deck-sources";

const WIDTH_EXPANDED = 232;
/** Match main app sidebar collapsed width. */
const WIDTH_COLLAPSED = 56;

type Props = {
  sources: DeckSource[];
  activeSourceId: string | null;
  collapsed: boolean;
  disabled?: boolean;
  onToggleCollapsed: () => void;
  onSelect: (sourceId: string) => void;
  onAddSource: () => void;
  /** Delete a source after the user confirms. Must not delete flashcards. */
  onDeleteSource: (sourceId: string) => Promise<void>;
};

/**
 * Collapsible sources panel for the Create view. Mirrors the main app
 * sidebar: Motion width animation, centered collapse control when closed,
 * and 32px nav items whose icons stay put while labels fade out.
 */
export function SourcesRail({
  sources,
  activeSourceId,
  collapsed,
  disabled,
  onToggleCollapsed,
  onSelect,
  onAddSource,
  onDeleteSource,
}: Props) {
  const reducedMotion = useReducedMotion();
  const transition = motionTransition(0.26, motionTokens.easeOut, reducedMotion ?? false);
  const collapseLabel = collapsed ? "Open sources" : "Close sources";
  const [pendingDelete, setPendingDelete] = useState<DeckSource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    <m.aside
      className={`create-sources-rail${collapsed ? " create-sources-rail--collapsed" : ""}`}
      aria-label="Sources"
      initial={false}
      animate={{ width: collapsed ? WIDTH_COLLAPSED : WIDTH_EXPANDED }}
      transition={transition}
    >
      <div
        className={`create-sources-rail__header${collapsed ? " create-sources-rail__header--collapsed" : ""}`}
      >
        {!collapsed ? <span className="create-sources-rail__title">Sources</span> : null}
        <RailHoverTip label={collapseLabel} enabled>
          {(handlers) => (
            <button
              type="button"
              className="notion-sidebar-icon-btn notion-sidebar-collapse-btn"
              onClick={onToggleCollapsed}
              aria-label={collapseLabel}
              aria-expanded={!collapsed}
              {...handlers}
            >
              <SidebarPanelIcon />
            </button>
          )}
        </RailHoverTip>
      </div>

      <div
        className={`create-sources-rail__nav${sources.length > 0 ? " create-sources-rail__nav--fill" : ""}`}
      >
        <RailHoverTip label="Add source" enabled={collapsed}>
          {(handlers) => (
            <button
              type="button"
              className="create-sources-rail__item create-sources-rail__item--add"
              onClick={onAddSource}
              disabled={disabled}
              aria-label="Add source"
              {...handlers}
            >
              <i className="ri-add-line" aria-hidden />
              <span className="create-sources-rail__item-label">Add source</span>
            </button>
          )}
        </RailHoverTip>

        {sources.map((source) => {
          const active = source.id === activeSourceId;
          return (
            <RailHoverTip key={source.id} label={source.title} enabled={collapsed}>
              {(handlers) => (
                <div
                  className={`create-sources-rail__row${active ? " create-sources-rail__row--active" : ""}`}
                >
                  <button
                    type="button"
                    className={`create-sources-rail__item${active ? " create-sources-rail__item--active" : ""}`}
                    onClick={() => onSelect(source.id)}
                    aria-pressed={active}
                    aria-label={source.title}
                    {...handlers}
                  >
                    <i
                      className={sourceTypeIconClass(source.type)}
                      aria-hidden
                      title={sourceTypeLabel(source.type)}
                    />
                    <span className="create-sources-rail__item-label">{source.title}</span>
                  </button>
                  {!collapsed ? (
                    <button
                      type="button"
                      className="create-sources-rail__delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteError(null);
                        setPendingDelete(source);
                      }}
                      disabled={disabled || deleting}
                      aria-label={`Delete ${source.title}`}
                      title="Delete source"
                    >
                      <i className="ri-delete-bin-line" aria-hidden />
                    </button>
                  ) : null}
                </div>
              )}
            </RailHoverTip>
          );
        })}
      </div>

      {sources.length === 0 ? (
        <div className="create-sources-rail__empty">
          <div className="create-sources-rail__empty-main">
            <i className="ri-book-open-line create-sources-rail__empty-icon" aria-hidden />
            <p className="create-sources-rail__empty-text">Saved sources appear here.</p>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <AnimatedModal
          title="Delete source?"
          onClose={deleting ? () => undefined : () => setPendingDelete(null)}
          maxWidth={420}
        >
          <div className="create-sources-rail__confirm">
            <p className="create-sources-rail__confirm-text">
              Delete <strong>{pendingDelete.title}</strong>? Your flashcards stay in this deck.
              Links from those cards back to this source will be removed.
            </p>
            {deleteError ? (
              <div className="create-sources-rail__confirm-error" role="alert">
                {deleteError}
              </div>
            ) : null}
            <div className="create-sources-rail__confirm-actions">
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
    </m.aside>
  );
}
