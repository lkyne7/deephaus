"use client";

import { useState } from "react";
import {
  ImportActions,
  ImportDropzone,
  ImportResult,
  ImportToggle,
} from "@/components/deck-import-parts";
import { taskPhaseLabel, useBackgroundTasks } from "@/lib/background-tasks/context";
import { MAX_APKG_GB, ankiPackageError, onlyFile } from "@/lib/import/import-files";

const LARGE_PACKAGE_BYTES = 80 * 1024 * 1024;

type PanelProps = {
  /** Closes the overlay or navigates back when used on a standalone page. */
  onBack?: () => void;
  backLabel?: string;
};

/** Shared Anki import form, used in the full page and in modal overlays. */
export function AnkiImportPanel({ onBack, backLabel = "Cancel" }: PanelProps) {
  const { tasks, startAnkiImport } = useBackgroundTasks();
  const [file, setFile] = useState<File | null>(null);
  const [keepScheduling, setKeepScheduling] = useState(true);
  const [combine, setCombine] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  const importTask =
    tasks.find((task) => task.id === activeTaskId) ??
    tasks.find((task) => task.kind === "anki-import");
  const importing = importTask?.status === "running";
  const result = importTask?.ankiResult ?? null;

  function chooseFiles(files: File[]) {
    if (files.length === 0) return;
    const picked = onlyFile(files);
    if ("error" in picked) {
      setError(picked.error);
      setFile(null);
      return;
    }
    const problem = ankiPackageError(picked.file);
    setError(problem);
    setFile(problem ? null : picked.file);
  }

  function runImport() {
    if (!file || importing) return;
    setError(null);
    const taskId = startAnkiImport(file, {
      deckName: combine && deckName.trim() ? deckName.trim() : undefined,
      scheduling: keepScheduling,
    });
    setActiveTaskId(taskId);
  }

  return (
    <div className="dhi-form">
      <ImportDropzone
        accept=".apkg,.colpkg"
        title={file ? file.name : "Drop an .apkg or .colpkg here"}
        hint={
          file ? (
            <>
              {(file.size / (1024 * 1024)).toFixed(1)} MB · <u>choose another file</u>
            </>
          ) : (
            <>
              or <u>browse your files</u> · up to {MAX_APKG_GB} GB
            </>
          )
        }
        onFiles={chooseFiles}
      />

      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="dhi-rows">
        <ImportToggle
          label="Keep scheduling"
          hint={
            keepScheduling
              ? "Due dates, FSRS state and deck preset come across"
              : "Cards import as new"
          }
          checked={keepScheduling}
          onChange={setKeepScheduling}
        />
        <ImportToggle label="Combine all decks into one" checked={combine} onChange={setCombine} />
      </div>

      {combine ? (
        <input
          className="input"
          value={deckName}
          onChange={(e) => setDeckName(e.target.value)}
          placeholder="New deck name"
          aria-label="New deck name"
        />
      ) : null}

      {file && file.size > LARGE_PACKAGE_BYTES ? (
        <div className="dh-note">
          <i className="ri-information-line" aria-hidden />
          <span>
            This is a large package. It uploads to secure storage and imports in the background,
            so you can leave this page while it runs.
          </span>
        </div>
      ) : null}

      {importTask && importTask.status !== "ready" ? (
        <div className="dhi-progress">
          <span>{taskPhaseLabel(importTask)}</span>
          {importing ? (
            <>
              <div className="dh-meter" aria-hidden>
                <span style={{ width: `${Math.max(importTask.progress, 8)}%` }} />
              </div>
              <span className="dhi-progress__hint">You can navigate away while this runs.</span>
            </>
          ) : importTask.status === "failed" ? (
            <span className="dhi-progress__error">{importTask.error ?? "Import failed"}</span>
          ) : null}
        </div>
      ) : null}

      <ImportActions
        onBack={onBack}
        backLabel={backLabel}
        submitLabel={importing ? "Importing in background…" : "Import"}
        submitDisabled={!file || importing || (combine && !deckName.trim())}
        onSubmit={runImport}
      />

      {result ? (
        <ImportResult
          summary={`Imported ${result.cardsImported} card${result.cardsImported === 1 ? "" : "s"} into ${
            result.decks.length
          } deck${result.decks.length === 1 ? "" : "s"}.`}
          decks={result.decks}
        >
          <ul className="dhi-result__stats">
            <li>
              {result.scheduledImported > 0
                ? `${result.scheduledImported} cards with scheduling restored`
                : "Cards imported as new (no scheduling)"}
            </li>
            {result.suspendedImported > 0 ? <li>{result.suspendedImported} suspended cards</li> : null}
            {(result.reviewLogsImported ?? 0) > 0 ? (
              <li>{result.reviewLogsImported} past reviews imported</li>
            ) : null}
            {result.mediaImported > 0 ? <li>{result.mediaImported} images imported</li> : null}
            {result.fsrsPresetsApplied > 0 ? (
              <li>{result.fsrsPresetsApplied} FSRS preset(s) applied at the deck level</li>
            ) : null}
          </ul>
        </ImportResult>
      ) : null}
    </div>
  );
}
