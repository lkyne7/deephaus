"use client";

import posthog from "posthog-js";
import { useMemo, useState } from "react";
import { ImportActions, ImportDropzone, ImportResult } from "@/components/deck-import-parts";
import type { AnkiImportResult } from "@/lib/background-tasks/api";
import { onlyFile } from "@/lib/import/import-files";
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

export function QuizletImportPanel({ onBack, backLabel = "Cancel" }: Props) {
  const [content, setContent] = useState("");
  const [deckName, setDeckName] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnkiImportResult | null>(null);
  const cardCount = useMemo(() => parseQuizletExport(content).length, [content]);

  async function chooseFiles(files: File[]) {
    if (files.length === 0) return;
    setResult(null);
    const picked = onlyFile(files);
    if ("error" in picked) {
      setError(picked.error);
      return;
    }
    const { file } = picked;
    setError(null);
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
      posthog.capture("deck_imported", {
        source: "quizlet",
        card_count: body.cardsImported,
      });
      setResult(body);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Quizlet import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="dhi-form">
      <p className="dhi-help">
        In Quizlet, export with a tab between each term and definition and a new line between cards.
        Paste the result, or use the exported file.
      </p>

      <ImportDropzone
        compact
        accept=".txt,.tsv,.csv,text/plain,text/tab-separated-values,text/csv"
        title={filename ?? "Drop a Quizlet export here"}
        hint={
          <>
            or <u>browse your files</u> · .txt, .tsv or .csv up to 5 MB
          </>
        }
        onFiles={(files) => void chooseFiles(files)}
      />

      <div className="field">
        <label className="field-label" htmlFor="quizlet-import-content">
          Exported cards
        </label>
        <textarea
          id="quizlet-import-content"
          className="input dhi-textarea"
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setFilename(null);
            setResult(null);
          }}
          placeholder={"Term 1\tDefinition 1\nTerm 2\tDefinition 2"}
          rows={6}
        />
        <span className="dhi-help">
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

      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}

      <ImportActions
        onBack={onBack}
        backLabel={backLabel}
        submitLabel={importing ? "Importing…" : "Import"}
        submitDisabled={cardCount === 0 || importing}
        onSubmit={() => void runImport()}
      />

      {result ? (
        <ImportResult
          summary={`Imported ${result.cardsImported.toLocaleString()} card${
            result.cardsImported === 1 ? "" : "s"
          }.`}
          decks={result.decks}
        />
      ) : null}
    </div>
  );
}
