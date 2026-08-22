"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DeleteDeckDialog } from "@/components/delete-deck-dialog";
import { RenameDeckDialog } from "@/components/rename-deck-dialog";
import {
  applyDuplicatedDeckToCaches,
  invalidateDeckCaches,
} from "@/lib/client-cache/prefetch";
import { duplicateProjectClient } from "@/lib/projects/delete-client";

export type DeckActionsDeck = {
  id: string;
  title: string;
  cardCount?: number;
  isPublished?: boolean;
  isCommunity?: boolean;
};

type Props = {
  deck: DeckActionsDeck;
  /** Hide actions that don't apply on this surface. */
  omit?: Array<
    | "open"
    | "study"
    | "create"
    | "browse"
    | "rename"
    | "duplicate"
    | "publish"
    | "export"
    | "delete"
  >;
  align?: "left" | "right";
  /** Compact icon button styling for table/grid rows. */
  size?: "sm" | "md";
  /** Match the Create page topbar icon buttons (deck switcher settings menu). */
  variant?: "default" | "create-topbar";
  onRenamed?: (name: string) => void;
  onDuplicated?: (deck: { id: string; name: string; cardCount?: number }) => void;
  onDeleted?: (deckId: string) => void;
  onPublish?: (deckId: string) => void;
};

const MENU_WIDTH = 240;
const MENU_GAP = 4;
const VIEWPORT_PAD = 8;

type MenuCoords = {
  top: number;
  left: number;
  maxHeight: number;
};

/**
 * Shared three-dot menu for deck-specific actions across Dashboard, Decks,
 * Create, and deck detail.
 *
 * The panel is portaled to `document.body` with fixed positioning so it is not
 * clipped by table/card `overflow: hidden` ancestors.
 */
export function DeckActionsMenu({
  deck,
  omit = [],
  align = "right",
  size = "sm",
  variant = "default",
  onRenamed,
  onDuplicated,
  onDeleted,
  onPublish,
}: Props) {
  const router = useRouter();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState<"duplicate" | "export" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hidden = new Set(omit);
  const empty = (deck.cardCount ?? 0) <= 0;

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const estimatedHeight = menuRef.current?.offsetHeight ?? 360;
    const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PAD;
    const spaceAbove = rect.top - VIEWPORT_PAD;
    const openUp = spaceBelow < Math.min(estimatedHeight, 280) && spaceAbove > spaceBelow;
    const maxHeight = Math.max(160, openUp ? spaceAbove - MENU_GAP : spaceBelow - MENU_GAP);
    const top = openUp
      ? Math.max(VIEWPORT_PAD, rect.top - Math.min(estimatedHeight, maxHeight) - MENU_GAP)
      : rect.bottom + MENU_GAP;
    const left =
      align === "right"
        ? Math.min(
            window.innerWidth - MENU_WIDTH - VIEWPORT_PAD,
            Math.max(VIEWPORT_PAD, rect.right - MENU_WIDTH),
          )
        : Math.min(
            window.innerWidth - MENU_WIDTH - VIEWPORT_PAD,
            Math.max(VIEWPORT_PAD, rect.left),
          );
    setCoords({ top, left, maxHeight });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updatePosition();
    // Remeasure after the portaled menu mounts so flip/maxHeight use real height.
    const frame = window.requestAnimationFrame(() => updatePosition());
    return () => window.cancelAnimationFrame(frame);
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onReposition() {
      updatePosition();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    // Capture scroll from nested overflow containers (table cards, etc.).
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, updatePosition]);

  const close = useCallback(() => setOpen(false), []);

  async function handleDuplicate() {
    close();
    setBusy("duplicate");
    setError(null);
    try {
      const copy = await duplicateProjectClient(deck.id);
      const name = copy.deck_name || copy.name;
      await applyDuplicatedDeckToCaches({
        id: copy.id,
        name,
        cardCount: copy.card_count || deck.cardCount,
      });
      onDuplicated?.({
        id: copy.id,
        name,
        cardCount: copy.card_count || deck.cardCount,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not duplicate deck.");
    } finally {
      setBusy(null);
    }
  }

  async function handleExport() {
    close();
    setBusy("export");
    setError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 180_000);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: deck.id }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          typeof body?.error === "string" && body.error
            ? body.error
            : `Export failed (${res.status})`,
        );
      }
      const blob = await res.blob();
      if (!blob.size) {
        throw new Error("Export produced an empty file.");
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${deck.title.replace(/[^a-z0-9-_]+/gi, "-") || "deck"}.apkg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Export timed out. Try again, or export a smaller deck.");
      } else {
        setError(err instanceof Error ? err.message : "Export failed.");
      }
    } finally {
      window.clearTimeout(timeout);
      setBusy(null);
    }
  }

  const menuPos = coords ?? { top: -9999, left: -9999, maxHeight: 360 };

  const menu = open
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={`Actions for ${deck.title}`}
            style={{
              ...s.menu,
              top: menuPos.top,
              left: menuPos.left,
              maxHeight: menuPos.maxHeight,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {!hidden.has("open") ? (
              <Link
                href={`/decks/${deck.id}`}
                role="menuitem"
                className="dh-menu-item"
                onClick={close}
              >
                <i className="ri-folder-open-line dh-menu-item__icon" aria-hidden />
                <span className="dh-menu-item__label">Open deck</span>
              </Link>
            ) : null}
            {!hidden.has("study") ? (
              empty ? (
                <button
                  type="button"
                  role="menuitem"
                  className="dh-menu-item"
                  disabled
                >
                  <i className="ri-book-open-line dh-menu-item__icon" aria-hidden />
                  <span className="dh-menu-item__label">Study</span>
                </button>
              ) : (
                <Link
                  href={`/decks/${deck.id}/study`}
                  role="menuitem"
                  className="dh-menu-item"
                  onClick={close}
                >
                  <i className="ri-book-open-line dh-menu-item__icon" aria-hidden />
                  <span className="dh-menu-item__label">Study</span>
                </Link>
              )
            ) : null}
            {!hidden.has("create") ? (
              <Link
                href={`/create?deck=${deck.id}`}
                role="menuitem"
                className="dh-menu-item"
                onClick={close}
              >
                <i className="ri-add-line dh-menu-item__icon" aria-hidden />
                <span className="dh-menu-item__label">Create cards</span>
              </Link>
            ) : null}
            {!hidden.has("browse") ? (
              <Link
                href={`/cards?deck=${deck.id}`}
                role="menuitem"
                className="dh-menu-item"
                onClick={close}
              >
                <i className="ri-table-line dh-menu-item__icon" aria-hidden />
                <span className="dh-menu-item__label">Browse cards</span>
              </Link>
            ) : null}

            <div style={s.divider} />

            {!hidden.has("rename") ? (
              <button
                type="button"
                role="menuitem"
                className="dh-menu-item"
                onClick={() => {
                  close();
                  setRenameOpen(true);
                }}
              >
                <i className="ri-pencil-line dh-menu-item__icon" aria-hidden />
                <span className="dh-menu-item__label">Rename</span>
              </button>
            ) : null}
            {!hidden.has("duplicate") ? (
              <button
                type="button"
                role="menuitem"
                className="dh-menu-item"
                onClick={() => void handleDuplicate()}
              >
                <i className="ri-file-copy-line dh-menu-item__icon" aria-hidden />
                <span className="dh-menu-item__label">Duplicate</span>
              </button>
            ) : null}
            {!hidden.has("publish") && !deck.isCommunity ? (
              <button
                type="button"
                role="menuitem"
                className="dh-menu-item"
                disabled={empty}
                onClick={() => {
                  close();
                  if (onPublish) {
                    onPublish(deck.id);
                    return;
                  }
                  router.push(`/decks/${deck.id}`);
                }}
              >
                <i
                  className={`${deck.isPublished ? "ri-share-forward-line" : "ri-earth-line"} dh-menu-item__icon`}
                  aria-hidden
                />
                <span className="dh-menu-item__label">
                  {deck.isPublished ? "Manage sharing" : "Publish to Community"}
                </span>
              </button>
            ) : null}
            {!hidden.has("export") ? (
              <button
                type="button"
                role="menuitem"
                className="dh-menu-item"
                disabled={empty}
                onClick={() => void handleExport()}
              >
                <i className="ri-download-2-line dh-menu-item__icon" aria-hidden />
                <span className="dh-menu-item__label">Export .apkg</span>
              </button>
            ) : null}

            {!hidden.has("delete") ? (
              <>
                <div style={s.divider} />
                <button
                  type="button"
                  role="menuitem"
                  className="dh-menu-item"
                  style={s.dangerItem}
                  onClick={() => {
                    close();
                    setDeleteOpen(true);
                  }}
                >
                  <i
                    className="ri-delete-bin-line dh-menu-item__icon"
                    style={{ color: "var(--grade-again)" }}
                    aria-hidden
                  />
                  <span
                    className="dh-menu-item__label"
                    style={{ color: "var(--grade-again)" }}
                  >
                    Delete deck
                  </span>
                </button>
              </>
            ) : null}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={rootRef}
      style={s.root}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        className={
          variant === "create-topbar"
            ? `create-topbar-control create-toolbar-pill create-settings-menu-btn${open ? " create-toolbar-pill--open" : ""}`
            : "btn btn-ghost btn-sm"
        }
        style={variant === "create-topbar" ? undefined : { ...s.trigger, ...(size === "sm" ? s.triggerSm : null) }}
        aria-label={`Deck actions for ${deck.title}`}
        title="Deck actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={busy != null}
        onClick={() => {
          setError(null);
          setOpen((v) => !v);
        }}
      >
        <i
          className={
            busy
              ? "ri-loader-4-line icon-spin"
              : variant === "create-topbar"
                ? "ri-more-2-fill create-topbar-control__icon create-topbar-control__icon--muted"
                : "ri-more-2-fill"
          }
          aria-hidden
        />
      </button>

      {menu}

      {busy === "export"
        ? createPortal(
            <div style={s.statusToast} role="status" aria-live="polite">
              <i className="ri-loader-4-line icon-spin" aria-hidden />
              <span>Exporting “{deck.title}” to Anki…</span>
            </div>,
            document.body,
          )
        : null}

      {error
        ? createPortal(
            <div style={s.errorToastPortal} role="alert">
              <span>{error}</span>
              <button
                type="button"
                style={s.errorClose}
                aria-label="Dismiss"
                onClick={() => setError(null)}
              >
                <i className="ri-close-line" />
              </button>
            </div>,
            document.body,
          )
        : null}

      <RenameDeckDialog
        open={renameOpen}
        projectId={deck.id}
        currentName={deck.title}
        onClose={() => setRenameOpen(false)}
        onRenamed={(name) => {
          invalidateDeckCaches();
          onRenamed?.(name);
          router.refresh();
        }}
      />

      <DeleteDeckDialog
        open={deleteOpen}
        projectId={deck.id}
        deckName={deck.title}
        isPublished={deck.isPublished}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          invalidateDeckCaches();
          onDeleted?.(deck.id);
          router.refresh();
        }}
      />
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    position: "relative",
    display: "inline-flex",
  },
  trigger: {
    padding: "4px 6px",
    minWidth: 0,
  },
  triggerSm: {
    width: 32,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  menu: {
    position: "fixed",
    zIndex: 1200,
    width: MENU_WIDTH,
    maxWidth: "min(240px, 90vw)",
    padding: 6,
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
    boxShadow: "var(--shadow-lg)",
    display: "flex",
    flexDirection: "column",
    gap: 2,
    boxSizing: "border-box",
    overflowY: "auto",
  },
  divider: {
    height: 1,
    background: "var(--border-1)",
    margin: "4px 0",
    flexShrink: 0,
  },
  dangerItem: {},
  statusToast: {
    position: "fixed",
    right: 20,
    bottom: 20,
    zIndex: 1300,
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    maxWidth: "min(360px, calc(100vw - 40px))",
    padding: "12px 14px",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
    boxShadow: "var(--shadow-lg)",
    color: "var(--ink-800)",
    font: "500 13px/18px var(--font-sans)",
  },
  errorToastPortal: {
    position: "fixed",
    right: 20,
    bottom: 20,
    zIndex: 1300,
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 200,
    maxWidth: "min(360px, calc(100vw - 40px))",
    padding: "12px 14px",
    borderRadius: "var(--radius-lg)",
    border: "1px solid rgba(217, 45, 32, 0.28)",
    background: "var(--grade-again-bg)",
    color: "var(--grade-again)",
    boxShadow: "var(--shadow-lg)",
    font: "500 13px/18px var(--font-sans)",
  },
  errorClose: {
    marginLeft: "auto",
    border: "none",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    padding: 2,
    display: "inline-flex",
  },
};
