"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { motionTokens, motionTransition } from "@/lib/motion";
import { ASSISTANT_EDIT_SUGGESTIONS } from "@/lib/cards/assistant-edit";

/**
 * Card Assistant — floating sparkle button that expands into a composer
 * anchored next to the control that opened it (header AI edit, a card's
 * sparkle, or the FAB). The parent owns scope/run state; this component
 * only renders, positions, and collects the instruction.
 */

export type CardAssistantPlacement = "header" | "card" | "fab";

const PANEL_GAP = 8;
const PANEL_MARGIN = 12;
const CARD_PANEL_WIDTH = 400;

function computePanelStyle(
  pane: HTMLElement,
  anchor: HTMLElement | null,
  placement: CardAssistantPlacement,
  panelHeight: number,
): { style: CSSProperties; origin: string } {
  if (placement === "fab" || !anchor) {
    return {
      style: { left: PANEL_MARGIN, right: PANEL_MARGIN, bottom: PANEL_MARGIN, top: "auto", width: "auto" },
      origin: "bottom right",
    };
  }

  const paneRect = pane.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const maxWidth = Math.max(240, paneRect.width - PANEL_MARGIN * 2);
  const width = placement === "header" ? maxWidth : Math.min(CARD_PANEL_WIDTH, maxWidth);

  let left =
    placement === "header" ? PANEL_MARGIN : a.right - paneRect.left - width;
  left = Math.max(PANEL_MARGIN, Math.min(left, paneRect.width - width - PANEL_MARGIN));

  const spaceBelow = paneRect.bottom - a.bottom - PANEL_GAP - PANEL_MARGIN;
  const spaceAbove = a.top - paneRect.top - PANEL_GAP - PANEL_MARGIN;
  const needed = Math.min(Math.max(panelHeight, 160), 280);
  const placeBelow = spaceBelow >= needed || spaceBelow >= spaceAbove;

  if (placeBelow) {
    return {
      style: {
        top: a.bottom - paneRect.top + PANEL_GAP,
        left,
        width,
        bottom: "auto",
        maxHeight: Math.max(140, spaceBelow),
      },
      origin: "top right",
    };
  }
  return {
    style: {
      bottom: paneRect.bottom - a.top + PANEL_GAP,
      left,
      width,
      top: "auto",
      maxHeight: Math.max(140, spaceAbove),
    },
    origin: "bottom right",
  };
}

export type CardAssistantScope =
  | { kind: "all"; count: number }
  | { kind: "selection"; count: number }
  | { kind: "card"; count: 1; preview: string };

export type CardAssistantStatus = "idle" | "running" | "done" | "error";

export type CardAssistantResult = {
  updated: number;
  scope: number;
  summary: string;
  canUndo: boolean;
};

type Props = {
  open: boolean;
  /** Hide the FAB entirely (e.g. no cards yet). */
  hidden?: boolean;
  disabled?: boolean;
  scope: CardAssistantScope;
  status: CardAssistantStatus;
  result: CardAssistantResult | null;
  error?: string | null;
  undoing?: boolean;
  /** Where the composer should sit, matching the control that opened it. */
  placement?: CardAssistantPlacement;
  /** Control that opened the composer; used to pin the panel next to it. */
  anchorEl?: HTMLElement | null;
  /** Positioned ancestor of the composer (the cards pane). */
  containerRef?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (instruction: string) => void;
  onUndo: () => void;
  onDismissResult: () => void;
};

function scopeLabel(scope: CardAssistantScope): React.ReactNode {
  if (scope.kind === "card") {
    return (
      <>
        applies to <strong>this card</strong>
        {scope.preview ? <> · {scope.preview}</> : null}
      </>
    );
  }
  if (scope.kind === "selection") {
    return (
      <>
        applies to <strong>{scope.count} selected {scope.count === 1 ? "card" : "cards"}</strong>
      </>
    );
  }
  return (
    <>
      applies to <strong>all {scope.count} {scope.count === 1 ? "card" : "cards"}</strong>
    </>
  );
}

export function CardAssistantBar({
  open,
  hidden = false,
  disabled = false,
  scope,
  status,
  result,
  error,
  undoing = false,
  placement = "fab",
  anchorEl = null,
  containerRef,
  onOpenChange,
  onSubmit,
  onUndo,
  onDismissResult,
}: Props) {
  const reducedMotion = useReducedMotion() ?? false;
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const [transformOrigin, setTransformOrigin] = useState("bottom right");
  const running = status === "running";
  const canSubmit = value.trim().length > 0 && !running && !disabled;
  const docked = placement === "fab" || !anchorEl;

  // Autofocus + auto-grow the textarea.
  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value, open]);

  // Clear the draft once a run succeeds so the next instruction starts fresh.
  useEffect(() => {
    if (status === "done") setValue("");
  }, [status]);

  // Pin the composer to the control that opened it (header, card, or FAB).
  useLayoutEffect(() => {
    if (!open) return;

    const update = () => {
      const pane = containerRef?.current ?? (panelRef.current?.offsetParent as HTMLElement | null);
      if (!pane) return;
      const height = panelRef.current?.offsetHeight ?? 180;
      const next = computePanelStyle(pane, anchorEl, placement, height);
      setPanelStyle(next.style);
      setTransformOrigin(next.origin);
    };

    update();
    const scrollRoot = anchorEl?.closest(".dh-create-cards-list") ?? null;
    scrollRoot?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scrollRoot?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [anchorEl, containerRef, open, placement, status, result, error, value]);

  const submit = useCallback(() => {
    const instruction = value.trim();
    if (!instruction || running || disabled) return;
    onSubmit(instruction);
  }, [disabled, onSubmit, running, value]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submit();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onOpenChange(false);
      }
    },
    [onOpenChange, submit],
  );

  const transition = motionTransition(motionTokens.duration.base, motionTokens.easeOut, reducedMotion);

  if (hidden) return null;

  return (
    <AnimatePresence initial={false} mode="wait">
      {open ? (
        <m.section
          key="panel"
          ref={panelRef}
          className={`dh-card-assistant${docked ? " dh-card-assistant--dock" : ` dh-card-assistant--${placement}`}`}
          role="region"
          aria-label="Card assistant"
          style={{ ...panelStyle, transformOrigin }}
          initial={{ opacity: 0, y: docked ? 12 : 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: docked ? 12 : 6, scale: 0.98 }}
          transition={transition}
        >
          <div className="dh-card-assistant__head">
            <i
              className={`dh-card-assistant__icon ${running ? "ri-loader-4-line icon-spin" : "ri-sparkling-2-fill"}`}
              aria-hidden
            />
            <span className="dh-card-assistant__title">Card Assistant</span>
            <span className="dh-card-assistant__scope">· {scopeLabel(scope)}</span>
            <button
              type="button"
              className="dh-card-assistant__close"
              onClick={() => onOpenChange(false)}
              aria-label="Close card assistant"
            >
              <i className="ri-close-line" aria-hidden />
            </button>
          </div>

          {status === "running" ? (
            <div className="dh-card-assistant__status dh-card-assistant__status--running" role="status">
              <i className="ri-loader-4-line icon-spin" aria-hidden />
              <span className="dh-card-assistant__status-text">
                Rewriting {scope.count} {scope.count === 1 ? "card" : "cards"}…
              </span>
            </div>
          ) : status === "done" && result ? (
            <div className="dh-card-assistant__status dh-card-assistant__status--done" role="status">
              <i className="ri-checkbox-circle-line" aria-hidden />
              <span
                className="dh-card-assistant__status-text"
                title={result.summary || undefined}
              >
                <strong>
                  Updated {result.updated} of {result.scope} {result.scope === 1 ? "card" : "cards"}
                </strong>
                {result.summary ? <> · {result.summary}</> : null}
              </span>
              {result.canUndo ? (
                <button
                  type="button"
                  className="dh-card-assistant__status-btn"
                  onClick={onUndo}
                  disabled={undoing}
                >
                  {undoing ? "Undoing…" : "Undo"}
                </button>
              ) : null}
              <button
                type="button"
                className="dh-card-assistant__status-dismiss"
                onClick={onDismissResult}
                aria-label="Dismiss"
              >
                <i className="ri-close-line" aria-hidden />
              </button>
            </div>
          ) : status === "error" && error ? (
            <div className="dh-card-assistant__status dh-card-assistant__status--error" role="alert">
              <i className="ri-error-warning-line" aria-hidden />
              <span className="dh-card-assistant__status-text" title={error}>
                {error}
              </span>
              <button
                type="button"
                className="dh-card-assistant__status-dismiss"
                onClick={onDismissResult}
                aria-label="Dismiss"
              >
                <i className="ri-close-line" aria-hidden />
              </button>
            </div>
          ) : (
            <div className="dh-card-assistant__chips">
              {ASSISTANT_EDIT_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  className="dh-card-assistant__chip"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    onSubmit(suggestion.prompt);
                  }}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>
          )}

          <div className="dh-card-assistant__composer">
            <div className="dh-card-assistant__input-wrap" data-disabled={running || disabled}>
              <textarea
                ref={inputRef}
                className="dh-card-assistant__input"
                rows={1}
                value={value}
                placeholder="Tell the assistant what to change"
                disabled={running || disabled}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                aria-label="Instruction for the card assistant"
              />
            </div>
            <button
              type="button"
              className="dh-card-assistant__submit"
              onClick={submit}
              disabled={!canSubmit}
              aria-label="Apply to cards"
              title="Apply (Enter)"
            >
              <i className="ri-arrow-up-line" aria-hidden />
            </button>
          </div>
        </m.section>
      ) : (
        <m.button
          key="fab"
          type="button"
          className="dh-card-assistant-fab"
          onClick={() => onOpenChange(true)}
          disabled={disabled}
          aria-label="Open card assistant"
          title="Edit cards with AI"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={transition}
        >
          <i className={running ? "ri-loader-4-line icon-spin" : "ri-sparkling-2-fill"} aria-hidden />
        </m.button>
      )}
    </AnimatePresence>
  );
}
