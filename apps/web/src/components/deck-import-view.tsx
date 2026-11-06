"use client";

import { useEffect, useState } from "react";
import { AnkiImportPanel } from "@/components/anki-import-view";
import { QuizletImportPanel } from "@/components/quizlet-import-view";
import "@/components/create/create-chat.css";

export type DeckImportMode = "anki" | "quizlet";

type PanelProps = {
  initialMode?: DeckImportMode;
  onBack?: () => void;
  backLabel?: string;
};

export function DeckImportPanel({
  initialMode = "anki",
  onBack,
  backLabel = "Back to create",
}: PanelProps) {
  const [mode, setMode] = useState<DeckImportMode>(initialMode);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  return (
    <div style={s.panel}>
      <div role="tablist" aria-label="Deck import source" className="dhc-tabs" style={s.tabs}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "anki"}
          className={`dhc-tabs__btn${mode === "anki" ? " is-active" : ""}`}
          onClick={() => setMode("anki")}
        >
          Anki
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "quizlet"}
          className={`dhc-tabs__btn${mode === "quizlet" ? " is-active" : ""}`}
          onClick={() => setMode("quizlet")}
        >
          Quizlet / Dekki
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
    <div style={s.shell}>
      <div style={s.pageCard}>
        <DeckImportPanel initialMode={initialMode} />
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    justifyContent: "center",
    padding: "32px 24px",
    boxSizing: "border-box",
  },
  pageCard: {
    width: "100%",
    maxWidth: 560,
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    padding: 24,
  },
  panel: { display: "flex", flexDirection: "column", gap: 18 },
  tabs: {
    alignSelf: "flex-start",
  },
};
