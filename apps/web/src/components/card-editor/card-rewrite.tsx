"use client";

import { useCallback, useEffect, useState } from "react";
import { generateCardMnemonicApi, regenerateCardApi } from "@/lib/cards/card-ai-actions-client";
import { supportsCardAiActions } from "@/lib/cards/mnemonic";

/** The content fields a one-click rewrite replaces (and an undo restores). */
export type CardContentFields = {
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
};

/** The two one-click AI rewrites every card editor offers. */
export type RewriteAction = "mnemonic" | "regenerate";

export const REWRITE_COPY: Record<
  RewriteAction,
  { icon: string; label: string; busyLabel: string; title: string; done: string; failed: string }
> = {
  mnemonic: {
    icon: "ri-lightbulb-flash-line",
    label: "Make a mnemonic",
    busyLabel: "Writing a mnemonic…",
    title: "Rewrite this card as a mnemonic card (1 credit)",
    done: "Rewritten as a mnemonic card.",
    failed: "Could not turn this card into a mnemonic card.",
  },
  regenerate: {
    icon: "ri-refresh-line",
    label: "Regenerate from source",
    busyLabel: "Regenerating…",
    title: "Regenerate this card from its source (1 credit)",
    done: "Card regenerated.",
    failed: "Could not regenerate this card.",
  },
};

type Options = {
  cardId: string;
  cardType: string;
  /** The fields as the editor shows them now, kept for Undo. */
  current: CardContentFields;
  /** Push pending edits first so the model sees what the user sees. */
  flush: () => Promise<unknown>;
  /** Put rewritten (or restored) fields into the editor's draft. */
  apply: (fields: CardContentFields, source: "rewrite" | "undo") => void;
  disabled?: boolean;
};

/**
 * Mnemonic / Regenerate for one card. The server saves the new fields; the
 * editor swaps them in and keeps the old ones so the change can be undone
 * (restoring the draft changes the snapshot, so auto-save persists the revert).
 */
export function useCardRewrite({ cardId, cardType, current, flush, apply, disabled }: Options) {
  const supported = supportsCardAiActions(cardType);
  const [rewriting, setRewriting] = useState<RewriteAction | null>(null);
  const [undo, setUndo] = useState<{ action: RewriteAction; previous: CardContentFields } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A notice belongs to the card it was made on.
  useEffect(() => {
    setUndo(null);
    setError(null);
  }, [cardId]);

  const run = useCallback(
    async (action: RewriteAction) => {
      if (!supported || disabled || rewriting) return;
      setRewriting(action);
      setError(null);
      const previous = { ...current };
      try {
        await flush();
        const next =
          action === "mnemonic" ? await generateCardMnemonicApi(cardId) : await regenerateCardApi(cardId);
        apply(
          { front: next.front, back: next.back, cloze_text: next.cloze_text, extra: next.extra },
          "rewrite",
        );
        setUndo({ action, previous });
      } catch (err) {
        setError(err instanceof Error ? err.message : REWRITE_COPY[action].failed);
      } finally {
        setRewriting(null);
      }
    },
    [apply, cardId, current, disabled, flush, rewriting, supported],
  );

  const undoRewrite = useCallback(() => {
    if (!undo) return;
    apply(undo.previous, "undo");
    setUndo(null);
  }, [apply, undo]);

  return {
    supported,
    rewriting,
    run,
    notice: (
      <CardRewriteNotice
        undoAction={undo?.action ?? null}
        error={error}
        onUndo={undoRewrite}
        onDismiss={() => {
          setUndo(null);
          setError(null);
        }}
      />
    ),
  };
}

function CardRewriteNotice({
  undoAction,
  error,
  onUndo,
  onDismiss,
}: {
  undoAction: RewriteAction | null;
  error: string | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  if (!undoAction && !error) return null;
  return (
    <div
      className={`dh-card-notice${error ? " dh-card-notice--error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <i className={error ? "ri-error-warning-line" : REWRITE_COPY[undoAction!].icon} aria-hidden />
      <span>{error ?? REWRITE_COPY[undoAction!].done}</span>
      {!error ? (
        <button type="button" onClick={onUndo}>
          Undo
        </button>
      ) : null}
      <button type="button" className="dh-card-notice__dismiss" onClick={onDismiss} aria-label="Dismiss">
        <i className="ri-close-line" aria-hidden />
      </button>
    </div>
  );
}
