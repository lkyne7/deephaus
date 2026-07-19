"use client";

import { applyLinkMark, normalizeLinkHref } from "@deephaus/rich-text";
import { getMarkRange } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./rich-text-bubble.css";

type LinkHoverState = {
  from: number;
  to: number;
  url: string;
  top: number;
  left: number;
};

const LINK_HOVER_SHOW_MS = 120;
const LINK_HOVER_HIDE_MS = 220;

type Props = {
  editor: Editor;
  /** Marks the document dirty (source autosave). Optional for card fields. */
  onEdit?: () => void;
};

/**
 * Notion-style link chip: appears on hover over a hyperlink with an editable
 * URL plus open / unlink actions.
 */
export function LinkHoverEditor({ editor, onEdit }: Props) {
  const [hover, setHover] = useState<LinkHoverState | null>(null);
  const hoverRef = useRef<LinkHoverState | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const pinnedRef = useRef(false);
  hoverRef.current = hover;

  const clearTimers = useCallback(() => {
    if (showTimerRef.current != null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    if (pinnedRef.current) return;
    clearTimers();
    setHover(null);
  }, [clearTimers]);

  const scheduleHide = useCallback(() => {
    if (pinnedRef.current) return;
    if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      if (!pinnedRef.current) setHover(null);
    }, LINK_HOVER_HIDE_MS);
  }, []);

  const showForAnchor = useCallback(
    (anchor: HTMLAnchorElement) => {
      if (!editor.view.dom.contains(anchor)) return;
      let pos: number;
      try {
        pos = editor.view.posAtDOM(anchor, 0);
      } catch {
        return;
      }
      const linkType = editor.schema.marks.link;
      if (!linkType) return;
      const docSize = editor.state.doc.content.size;
      let range: { from: number; to: number } | undefined;
      for (const candidate of [pos + 1, pos, Math.max(0, pos - 1)]) {
        const clamped = Math.max(0, Math.min(candidate, docSize));
        const found = getMarkRange(editor.state.doc.resolve(clamped), linkType);
        if (found && found.from < found.to) {
          range = found;
          break;
        }
      }
      if (!range) return;
      const href = anchor.getAttribute("href") ?? "";
      const rect = anchor.getBoundingClientRect();
      const left = Math.min(
        window.innerWidth - 16,
        Math.max(16, rect.left + rect.width / 2),
      );
      const top = Math.max(8, rect.top - 8);
      setHover((prev) => {
        if (
          prev &&
          prev.from === range.from &&
          prev.to === range.to &&
          (pinnedRef.current || document.activeElement === inputRef.current)
        ) {
          return { ...prev, top, left };
        }
        return {
          from: range.from,
          to: range.to,
          url: href,
          top,
          left,
        };
      });
    },
    [editor],
  );

  useEffect(() => {
    const dom = editor.view.dom;

    const onOver = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || !dom.contains(anchor)) return;
      clearTimers();
      showTimerRef.current = window.setTimeout(() => {
        showTimerRef.current = null;
        showForAnchor(anchor);
      }, LINK_HOVER_SHOW_MS);
    };

    const onOut = (event: MouseEvent) => {
      const related = event.relatedTarget as HTMLElement | null;
      if (related?.closest?.(".dh-rt-link-hover")) return;
      const nextAnchor = related?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (nextAnchor && dom.contains(nextAnchor)) return;
      if (showTimerRef.current != null) {
        window.clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      scheduleHide();
    };

    const onScroll = () => {
      if (!pinnedRef.current) hide();
    };

    dom.addEventListener("mouseover", onOver);
    dom.addEventListener("mouseout", onOut);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      clearTimers();
      dom.removeEventListener("mouseover", onOver);
      dom.removeEventListener("mouseout", onOut);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [editor, clearTimers, hide, scheduleHide, showForAnchor]);

  const applyUrl = useCallback(() => {
    const current = hoverRef.current;
    if (!current) return;
    onEdit?.();
    if (applyLinkMark(editor, current.url, { from: current.from, to: current.to })) {
      pinnedRef.current = false;
      const href = normalizeLinkHref(current.url);
      setHover((prev) => (prev ? { ...prev, url: href ?? prev.url } : prev));
    }
  }, [editor, onEdit]);

  const openLink = useCallback(() => {
    const current = hoverRef.current;
    if (!current?.url) return;
    const href = normalizeLinkHref(current.url);
    if (!href) return;
    window.open(href, "_blank", "noopener,noreferrer");
  }, []);

  const unlink = useCallback(() => {
    const current = hoverRef.current;
    if (!current) return;
    onEdit?.();
    editor
      .chain()
      .focus()
      .setTextSelection({ from: current.from, to: current.to })
      .unsetMark("link")
      .run();
    pinnedRef.current = false;
    setHover(null);
  }, [editor, onEdit]);

  if (!hover) return null;

  return createPortal(
    <div
      className="dh-rt-link-hover"
      style={{ top: hover.top, left: hover.left }}
      onMouseEnter={() => {
        clearTimers();
      }}
      onMouseLeave={() => {
        if (!pinnedRef.current) scheduleHide();
      }}
    >
      <form
        className="dh-rt-link-hover-form"
        onSubmit={(e) => {
          e.preventDefault();
          applyUrl();
        }}
      >
        <i className="ri-link dh-rt-link-form-icon" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          inputMode="url"
          autoComplete="url"
          className="dh-rt-link-input"
          value={hover.url}
          placeholder="https://example.com"
          aria-label="Link URL"
          onFocus={() => {
            pinnedRef.current = true;
            clearTimers();
          }}
          onBlur={() => {
            pinnedRef.current = false;
            applyUrl();
            scheduleHide();
          }}
          onChange={(e) => {
            const value = e.target.value;
            setHover((prev) => (prev ? { ...prev, url: value } : prev));
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              pinnedRef.current = false;
              setHover(null);
              editor.commands.focus();
            }
          }}
        />
        <button
          type="button"
          className="dh-rt-btn"
          aria-label="Open link"
          title="Open link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openLink}
          disabled={!hover.url.trim()}
        >
          <i className="ri-external-link-line" aria-hidden />
        </button>
        <button
          type="button"
          className="dh-rt-btn"
          aria-label="Remove link"
          title="Remove link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={unlink}
        >
          <i className="ri-link-unlink" aria-hidden />
        </button>
      </form>
    </div>,
    document.body,
  );
}
