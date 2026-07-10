"use client";

import { useEffect } from "react";
import { AnkiImportPanel } from "@/components/anki-import-view";

type Props = {
  open: boolean;
  onClose: () => void;
  backLabel?: string;
};

/** Modal overlay for importing an Anki .apkg without leaving the current page. */
export function AnkiImportOverlay({ open, onClose, backLabel = "Back to create" }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div style={s.overlay} onClick={onClose} role="presentation">
      <div
        style={s.card}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="anki-import-title"
      >
        <AnkiImportPanel onBack={onClose} backLabel={backLabel} />
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "var(--bg-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 100,
  },
  card: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "85vh",
    overflow: "auto",
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    boxShadow: "var(--shadow-xl)",
    padding: 24,
  },
};
