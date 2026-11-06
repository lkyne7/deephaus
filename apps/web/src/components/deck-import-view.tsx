"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnkiImportPanel } from "@/components/anki-import-view";
import { QuizletImportPanel } from "@/components/quizlet-import-view";
import "@/components/deck-import.css";

export type DeckImportMode = "anki" | "quizlet";

type PanelProps = {
  initialMode?: DeckImportMode;
  onBack?: () => void;
  backLabel?: string;
};

export function DeckImportPanel({ initialMode = "anki", onBack, backLabel = "Cancel" }: PanelProps) {
  const [mode, setMode] = useState<DeckImportMode>(initialMode);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  return (
    <div className="dhi-panel">
      <div role="tablist" aria-label="Deck import source" className="dh-seg dhi-seg">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "anki"}
          onClick={() => setMode("anki")}
        >
          Anki
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "quizlet"}
          onClick={() => setMode("quizlet")}
        >
          Quizlet
        </button>
      </div>

      {mode === "anki" ? (
        <AnkiImportPanel onBack={onBack} backLabel={backLabel} />
      ) : (
        <QuizletImportPanel onBack={onBack} backLabel={backLabel} />
      )}
    </div>
  );
}

export function DeckImportView({ initialMode = "anki" }: { initialMode?: DeckImportMode }) {
  return (
    <div className="dhi-page">
      <div className="dh-surface dhi-card">
        <div className="dhi-head">
          <h1 className="dhi-title">Import a deck</h1>
          <Link href="/create" className="dhi-close" aria-label="Close">
            <i className="ri-close-line" aria-hidden />
          </Link>
        </div>
        <DeckImportPanel initialMode={initialMode} />
      </div>
    </div>
  );
}
