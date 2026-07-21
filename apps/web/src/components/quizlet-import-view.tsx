"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { AnkiImportResult } from "@/lib/background-tasks/api";
import {
  MAX_QUIZLET_IMPORT_BYTES,
  parseQuizletExport,
} from "@/lib/import/quizlet";

type Props = {
  onBack?: () => void;
  backLabel?: string;
};

function fileDeckName(filename: string): string {
  return filename.replace(/^.*[/\\]/, "").replace(/\.(txt|tsv|csv)$/i, "").trim();
}

export function QuizletImportPanel({ onBack, backLabel = "Back to create" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState("");
  const [deckName, setDeckName] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnkiImportResult | null>(null);
  const cardCount = useMemo(() => parseQuizletExport(content).length, [content]);

  async function chooseFile(file: File | null) {
    if (!file) return;
    setError(null);
    setResult(null);
    if (!/\.(txt|tsv|csv)$/i.test(file.name)) {
      setError("Choose a Quizlet text, TSV, or CSV export.");
      return;
    }
    if (file.size > MAX_QUIZLET_IMPORT_BYTES) {
      setError("Quizlet exports must be 5 MB or smaller.");
      return;
    }
    try {
      setContent(await file.text());
      setFilename(file.name);
      setDeckName((current) => current || fileDeckName(file.name));
    } catch {
      setError("Could not read that export file.");
    }
  }

  async function runImport() {
    if (!content.trim() || importing) return;
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/import/quizlet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          deck_name: deckName.trim() || undefined,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | (AnkiImportResult & { error?: string })
        | null;
      if (!response.ok || !body) {
        throw new Error(body?.error ?? "Quizlet import failed.");
      }
      setResult(body);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Quizlet import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={s.panel}>
      <div style={s.header}>
        <span style={s.iconBadge} aria-hidden>
          <i className="ri-file-copy-2-line" />
        </span>
        <div>
          <h1 id="quizlet-import-title" style={s.title}>
            Import from Quizlet
          </h1>
          <p style={s.subtitle}>
            In Quizlet, export with a tab between each term and definition and a new line between
            cards. Paste the result or upload the exported text file.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values,text/csv"
        onChange={(event) => void chooseFile(event.target.files?.[0] ?? null)}
        style={{ display: "none" }}
      />
      <button type="button" style={s.dropzone} onClick={() => inputRef.current?.click()}>
        <i className="ri-upload-cloud-2-line" style={{ fontSize: 26, color: "var(--ink-400)" }} />
        <span style={s.dropzoneTitle}>{filename ?? "Choose a Quizlet export file"}</span>
        <span style={s.hint}>.txt, .tsv, or .csv · up to 5 MB</span>
      </button>

      <div className="field">
        <label className="field-label" htmlFor="quizlet-import-content">
          Exported cards
        </label>
        <textarea
          id="quizlet-import-content"
          className="input"
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setFilename(null);
            setResult(null);
          }}
          placeholder={"Term 1\tDefinition 1\nTerm 2\tDefinition 2"}
          rows={8}
          style={s.textarea}
        />
        <span style={s.hint}>
          {cardCount > 0
            ? `${cardCount.toLocaleString()} card${cardCount === 1 ? "" : "s"} detected`
            : "Terms and definitions must be separated by tabs."}
        </span>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="quizlet-import-deck-name">
          Deck name
        </label>
        <input
          id="quizlet-import-deck-name"
          className="input"
          value={deckName}
          onChange={(event) => setDeckName(event.target.value)}
          placeholder="Quizlet import"
          maxLength={120}
        />
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <div style={s.actions}>
        {onBack ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
            {backLabel}
          </button>
        ) : (
          <Link href="/create" className="btn btn-ghost btn-sm">
            {backLabel}
          </Link>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={cardCount === 0 || importing}
          onClick={() => void runImport()}
        >
          {importing ? "Importing…" : "Import deck"}
        </button>
      </div>

      {result ? (
        <div style={s.result}>
          <div style={s.resultHead}>
            <i className="ri-checkbox-circle-fill" style={{ color: "var(--teal-500)" }} />
            <span>
              Imported {result.cardsImported.toLocaleString()} card
              {result.cardsImported === 1 ? "" : "s"}.
            </span>
          </div>
          {result.decks.map((deck) => (
            <div key={deck.id} style={s.deckRow}>
              <span style={s.deckName}>{deck.name}</span>
              <span style={s.deckCount}>{deck.cardCount.toLocaleString()} cards</span>
              <Link href={`/decks/${deck.id}`} className="btn btn-primary btn-sm">
                Open deck
              </Link>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  panel: { display: "flex", flexDirection: "column", gap: 16 },
  header: { display: "flex", gap: 14, alignItems: "flex-start" },
  iconBadge: {
    flexShrink: 0,
    width: 44,
    height: 44,
    borderRadius: 8,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--brand-25)",
    color: "var(--teal-500)",
    fontSize: 22,
  },
  title: { margin: 0, font: "600 20px/28px var(--font-sans)", color: "var(--ink-900)" },
  subtitle: { margin: "4px 0 0", font: "400 13px/20px var(--font-sans)", color: "var(--fg-4)" },
  dropzone: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    padding: "14px 16px",
    border: "1px dashed var(--border-1)",
    borderRadius: 8,
    background: "var(--paper-soft)",
    cursor: "pointer",
    textAlign: "left",
  },
  dropzoneTitle: { color: "var(--ink-700)", font: "500 14px/20px var(--font-sans)" },
  hint: { font: "400 12px/18px var(--font-sans)", color: "var(--fg-4)" },
  textarea: { minHeight: 150, resize: "vertical", fontFamily: "var(--font-mono)" },
  actions: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  result: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    borderTop: "1px solid var(--border-1)",
    paddingTop: 16,
  },
  resultHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    font: "600 14px/20px var(--font-sans)",
    color: "var(--ink-900)",
  },
  deckRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    background: "var(--paper-soft)",
  },
  deckName: { flex: 1, minWidth: 0, font: "600 13px/18px var(--font-sans)", color: "var(--ink-900)" },
  deckCount: { font: "400 12px/16px var(--font-sans)", color: "var(--fg-4)" },
};
