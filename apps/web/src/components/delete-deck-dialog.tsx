"use client";

import { useState } from "react";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { deleteProjectClient } from "@/lib/projects/delete-client";

type Props = {
  open: boolean;
  projectId: string;
  deckName: string;
  isPublished?: boolean;
  onClose: () => void;
  onDeleted: () => void;
};

/**
 * Confirm permanent deck deletion. Warns when the deck is published to Community.
 */
export function DeleteDeckDialog({
  open,
  projectId,
  deckName,
  isPublished = false,
  onClose,
  onDeleted,
}: Props) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteProjectClient(projectId);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete deck.");
    } finally {
      setDeleting(false);
    }
  }

  if (!open) return null;

  return (
    <AnimatedModal
      title="Delete deck?"
      onClose={deleting ? () => undefined : onClose}
      maxWidth={440}
    >
      <div style={s.body}>
        <p style={s.text}>
          Delete <strong>{deckName}</strong>? This permanently removes the deck,
          its cards, sources, and study history. This cannot be undone.
        </p>
        {isPublished ? (
          <p style={s.warn}>
            This deck is published to Community. Deleting it removes the public
            listing and subscription links. Existing subscribers keep their local
            copies.
          </p>
        ) : null}
        {error ? (
          <div style={s.error} role="alert">
            {error}
          </div>
        ) : null}
        <div style={s.footer}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void confirm()}
            disabled={deleting}
          >
            {deleting ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
            Delete deck
          </button>
        </div>
      </div>
    </AnimatedModal>
  );
}

const s: Record<string, React.CSSProperties> = {
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  text: {
    margin: 0,
    font: "400 14px/20px var(--font-sans)",
    color: "var(--ink-700)",
  },
  warn: {
    margin: 0,
    font: "400 13px/18px var(--font-sans)",
    color: "var(--ink-600)",
    background: "var(--paper-soft)",
    border: "1px solid var(--border-1)",
    borderRadius: 8,
    padding: "10px 12px",
  },
  error: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--grade-again)",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  },
};
