"use client";

import { useEffect } from "react";
import { DeckImportPanel, type DeckImportMode } from "@/components/deck-import-view";
import { AnimatedModal } from "@/components/motion/animated-modal";

type Props = {
  open: boolean;
  onClose: () => void;
  backLabel?: string;
  initialMode?: DeckImportMode;
};

/** Modal overlay for importing an Anki or Quizlet deck without leaving the current page. */
export function AnkiImportOverlay({
  open,
  onClose,
  backLabel = "Cancel",
  initialMode = "anki",
}: Props) {
  // A file that misses the drop zone would otherwise navigate the tab to it.
  useEffect(() => {
    if (!open) return;
    function swallow(event: DragEvent) {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    }
    document.addEventListener("dragover", swallow);
    document.addEventListener("drop", swallow);
    return () => {
      document.removeEventListener("dragover", swallow);
      document.removeEventListener("drop", swallow);
    };
  }, [open]);

  return (
    <AnimatedModal title="Import a deck" open={open} onClose={onClose} maxWidth={480} closeOnEscape>
      <DeckImportPanel initialMode={initialMode} onBack={onClose} backLabel={backLabel} />
    </AnimatedModal>
  );
}
