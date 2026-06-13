"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const AI_ASSISTANT_MENU_ID = "app-ai-assistant-menu";

const CardContentRenderer = dynamic(
  () =>
    import("@/components/rich-text/card-content-renderer").then((m) => m.CardContentRenderer),
  { ssr: false },
);
import { actionsForContext, type AiActionDef, type AiActionId } from "@/lib/ai-assistant/actions";
import { useResolvedAiContext, type AiPageContext } from "@/lib/ai-assistant/context";

type ResultState =
  | { status: "idle" }
  | { status: "loading"; action: AiActionDef }
  | { status: "error"; action: AiActionDef; message: string }
  | { status: "done"; action: AiActionDef; markdown: string };

async function runAction(
  action: AiActionDef,
  ctx: AiPageContext,
): Promise<string> {
  // Explain reuses the existing per-card endpoint.
  if (action.id === "explain-card" && ctx.page === "study-card" && ctx.card.id) {
    const res = await fetch(`/api/cards/${ctx.card.id}/explain`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error((await res.text()) || "Request failed");
    const data = (await res.json()) as { explanation?: string; error?: string };
    if (data.error) throw new Error(data.error);
    return data.explanation ?? "";
  }

  const body: {
    action: AiActionId;
    deck_id?: string;
    card_id?: string;
    payload?: Record<string, unknown>;
  } = { action: action.id };

  if (ctx.page === "study-card") {
    body.deck_id = ctx.deckId;
    if (ctx.card.id) body.card_id = ctx.card.id;
    body.payload = { card: ctx.card };
  } else if (ctx.page === "deck") {
    body.deck_id = ctx.deckId;
  } else if (ctx.page === "create") {
    if (ctx.deckId) body.deck_id = ctx.deckId;
    if (ctx.card?.id) body.card_id = ctx.card.id;
    body.payload = {
      ...(ctx.card ? { card: ctx.card } : {}),
      ...(ctx.sourceText ? { source_text: ctx.sourceText } : {}),
    };
  }

  const res = await fetch("/api/assistant", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = "Request failed";
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // keep generic message
    }
    throw new Error(message);
  }
  const data = (await res.json()) as { markdown?: string };
  return data.markdown ?? "";
}

/** Sparkle button + popover with per-page AI actions. */
export function AiAssistantMenu() {
  const pathname = usePathname();
  const ctx = useResolvedAiContext(pathname);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ResultState>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Reset stale results when the page context changes.
  useEffect(() => {
    setResult({ status: "idle" });
    setCopied(false);
  }, [pathname]);

  if (!ctx) return null;

  const actions = actionsForContext(ctx);
  if (!actions.length) return null;

  async function select(action: AiActionDef) {
    if (!ctx) return;
    setCopied(false);
    setResult({ status: "loading", action });
    try {
      const markdown = await runAction(action, ctx);
      setResult({ status: "done", action, markdown });
    } catch (err) {
      setResult({
        status: "error",
        action,
        message: err instanceof Error ? err.message : "Something went wrong",
      });
    }
  }

  async function copyResult() {
    if (result.status !== "done") return;
    try {
      await navigator.clipboard.writeText(result.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  }

  const busy = result.status === "loading";

  return (
    <div ref={rootRef} style={s.root}>
      <button
        type="button"
        className="notion-topbar-icon-btn"
        title="AI assistant"
        aria-label="AI assistant"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={AI_ASSISTANT_MENU_ID}
        onClick={() => setOpen((value) => !value)}
        style={{ color: "var(--fg-brand)" }}
      >
        <i className={busy ? "ri-loader-4-line icon-spin" : "ri-sparkling-2-line"} aria-hidden />
      </button>

      {open ? (
        <div id={AI_ASSISTANT_MENU_ID} role="menu" aria-label="AI assistant" style={s.panel}>
          <div style={s.panelHeader}>
            <i className="ri-sparkling-2-line" style={{ fontSize: 14 }} aria-hidden />
            AI assistant
          </div>

          {actions.map((action) => {
            const active =
              result.status !== "idle" && result.action.id === action.id;
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className="topbar-menu__item"
                style={{
                  ...s.item,
                  background: active ? "var(--bg-surface-2)" : "none",
                }}
                disabled={busy}
                onClick={() => void select(action)}
              >
                <span style={s.itemIcon} aria-hidden>
                  <i className={action.icon} />
                </span>
                <span style={s.itemCopy}>
                  <span style={s.itemLabel}>{action.label}</span>
                  <span style={s.itemDescription}>{action.description}</span>
                </span>
                {result.status === "loading" && result.action.id === action.id ? (
                  <i className="ri-loader-4-line icon-spin" style={s.itemSpinner} aria-hidden />
                ) : null}
              </button>
            );
          })}

          {result.status === "error" ? (
            <div style={s.resultBox}>
              <div style={s.error}>{result.message}</div>
              <div style={s.resultActions}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void select(result.action)}
                >
                  <i className="ri-refresh-line" />
                  Retry
                </button>
              </div>
            </div>
          ) : null}

          {result.status === "done" ? (
            <div style={s.resultBox}>
              <div style={s.resultHeader}>
                <span style={s.resultTitle}>{result.action.label}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void copyResult()}
                  title="Copy result"
                >
                  <i className={copied ? "ri-check-line" : "ri-file-copy-line"} />
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div style={s.resultContent}>
                <CardContentRenderer content={result.markdown} />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    position: "relative",
    display: "inline-flex",
  },
  panel: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    zIndex: 40,
    width: 360,
    maxWidth: "calc(100vw - 32px)",
    padding: 6,
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
    boxShadow: "var(--shadow-lg)",
    display: "flex",
    flexDirection: "column",
    maxHeight: "min(560px, calc(100vh - 96px))",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px 8px",
    font: "600 12px/16px var(--font-sans)",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: "var(--fg-quaternary)",
  },
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
    border: "none",
    cursor: "pointer",
    textAlign: "left",
    width: "100%",
    transition: "background 0.15s ease",
  },
  itemIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: "var(--bg-surface-2)",
    color: "var(--fg-secondary)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: 15,
  },
  itemCopy: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    minWidth: 0,
    flex: 1,
  },
  itemLabel: {
    font: "500 13.5px/19px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  itemDescription: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-quaternary)",
  },
  itemSpinner: {
    fontSize: 15,
    color: "var(--fg-tertiary)",
    marginTop: 6,
    flexShrink: 0,
  },
  resultBox: {
    marginTop: 6,
    borderTop: "1px solid var(--border-secondary)",
    paddingTop: 8,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minHeight: 0,
  },
  resultHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "0 10px",
  },
  resultTitle: {
    font: "600 13px/18px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  resultActions: {
    display: "flex",
    justifyContent: "flex-end",
    padding: "0 10px 4px",
  },
  resultContent: {
    overflowY: "auto",
    padding: "0 10px 8px",
    font: "400 13.5px/20px var(--font-sans)",
    color: "var(--fg-secondary)",
    minHeight: 0,
  },
  error: {
    margin: "0 10px",
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
    background: "var(--grade-again-bg)",
    color: "var(--grade-again)",
    font: "400 13px/18px var(--font-sans)",
  },
};
