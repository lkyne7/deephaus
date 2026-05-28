"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { MAX_APKG_BYTES } from "@deephaus/shared";

type ImportResult = {
  decks: Array<{ id: string; name: string; cardCount: number }>;
  cardsImported: number;
  scheduledImported: number;
  suspendedImported: number;
  mediaImported: number;
  mediaSkipped: number;
  fsrsPresetsApplied: number;
};

const MAX_GB = Math.round(MAX_APKG_BYTES / (1024 * 1024 * 1024));

async function readError(res: Response): Promise<string> {
  const body = await res.text();
  try {
    return (JSON.parse(body) as { error?: string }).error ?? body;
  } catch {
    return body || `Import failed (${res.status})`;
  }
}

export function AnkiImportView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [keepScheduling, setKeepScheduling] = useState(true);
  const [combine, setCombine] = useState(false);
  const [deckName, setDeckName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  function chooseFile(next: File | null) {
    setError(null);
    setResult(null);
    if (next && !/\.(apkg|colpkg)$/i.test(next.name)) {
      setError("Choose an Anki package (.apkg) file.");
      setFile(null);
      return;
    }
    if (next && next.size > MAX_APKG_BYTES) {
      setError(`File must be under ${MAX_GB} GB.`);
      setFile(null);
      return;
    }
    setFile(next);
  }

  async function runImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      if (combine && deckName.trim()) form.append("deck_name", deckName.trim());
      if (!keepScheduling) form.append("scheduling", "false");

      const res = await fetch("/api/import/anki", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) throw new Error(await readError(res));
      setResult((await res.json()) as ImportResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={s.shell}>
      <div style={s.card}>
        <div style={s.header}>
          <span style={s.iconBadge} aria-hidden>
            <i className="ri-folder-download-line" />
          </span>
          <div>
            <h1 style={s.title}>Import from Anki</h1>
            <p style={s.subtitle}>
              Upload an Anki package (.apkg). Cards, scheduling, and the deck&apos;s FSRS
              preset come across.
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".apkg,.colpkg"
          onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
          style={{ display: "none" }}
        />
        <button type="button" style={s.dropzone} onClick={() => inputRef.current?.click()}>
          <i className="ri-upload-cloud-2-line" style={{ fontSize: 30, color: "var(--ink-400)" }} />
          <span style={s.dropzoneTitle}>{file ? file.name : "Click to choose a .apkg file"}</span>
          <span style={s.hint}>
            {file
              ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
              : `Anki / AnkiDroid export · up to ${MAX_GB} GB`}
          </span>
        </button>

        <label style={s.checkboxRow}>
          <input
            type="checkbox"
            checked={keepScheduling}
            onChange={(e) => setKeepScheduling(e.target.checked)}
          />
          <span>
            Keep scheduling
            <span style={s.optionHint}>Due dates, FSRS state &amp; deck preset. Off imports cards as new.</span>
          </span>
        </label>

        <label style={s.checkboxRow}>
          <input type="checkbox" checked={combine} onChange={(e) => setCombine(e.target.checked)} />
          <span>Combine all decks into one</span>
        </label>
        {combine && (
          <input
            className="input"
            value={deckName}
            onChange={(e) => setDeckName(e.target.value)}
            placeholder="New deck name"
          />
        )}

        {error && <div className="notice notice-error">{error}</div>}

        <div style={s.actions}>
          <Link href="/decks/new" className="btn btn-ghost btn-sm">
            Back to create
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!file || busy || (combine && !deckName.trim())}
            onClick={() => void runImport()}
          >
            {busy ? "Importing…" : "Import deck"}
          </button>
        </div>

        {busy && (
          <p style={s.note}>
            <i className="ri-loader-4-line icon-spin" /> Reading the package and rebuilding
            scheduling — large decks can take a moment.
          </p>
        )}

        {result && (
          <div style={s.result}>
            <div style={s.resultHead}>
              <i className="ri-checkbox-circle-fill" style={{ color: "var(--teal-500)" }} />
              <span>
                Imported {result.cardsImported} card{result.cardsImported === 1 ? "" : "s"} into{" "}
                {result.decks.length} deck{result.decks.length === 1 ? "" : "s"}.
              </span>
            </div>
            <ul style={s.stats}>
              <li>
                {result.scheduledImported > 0
                  ? `${result.scheduledImported} cards with scheduling restored`
                  : "Cards imported as new (no scheduling)"}
              </li>
              {result.suspendedImported > 0 && <li>{result.suspendedImported} suspended cards</li>}
              {result.mediaImported > 0 && <li>{result.mediaImported} images imported</li>}
              {result.fsrsPresetsApplied > 0 && (
                <li>{result.fsrsPresetsApplied} FSRS preset(s) applied at the deck level</li>
              )}
            </ul>
            <div style={s.deckLinks}>
              {result.decks.map((deck) => (
                <div key={deck.id} style={s.deckRow}>
                  <span style={s.deckName}>{deck.name}</span>
                  <span style={s.deckCount}>{deck.cardCount} cards</span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Link href={`/decks/${deck.id}`} className="btn btn-ghost btn-sm">
                      Open
                    </Link>
                    <Link href={`/decks/${deck.id}/study`} className="btn btn-primary btn-sm">
                      Study
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
  card: {
    width: "100%",
    maxWidth: 560,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 14,
    padding: 24,
  },
  header: { display: "flex", gap: 14, alignItems: "flex-start" },
  iconBadge: {
    flexShrink: 0,
    width: 44,
    height: 44,
    borderRadius: 12,
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
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    padding: "32px 16px",
    border: "1px dashed var(--border-1)",
    borderRadius: 12,
    background: "var(--paper-soft)",
    cursor: "pointer",
    textAlign: "center",
  },
  dropzoneTitle: { color: "var(--ink-700)", font: "500 14px/20px var(--font-sans)" },
  hint: { font: "400 12px/18px var(--font-sans)", color: "var(--fg-4)" },
  checkboxRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    font: "400 13px/20px var(--font-sans)",
    color: "var(--ink-700)",
    cursor: "pointer",
  },
  optionHint: {
    display: "block",
    font: "400 12px/17px var(--font-sans)",
    color: "var(--fg-4)",
    marginTop: 2,
  },
  actions: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  note: { margin: 0, font: "400 13px/20px var(--font-sans)", color: "var(--fg-3)" },
  result: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
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
  stats: {
    margin: 0,
    paddingLeft: 18,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-3)",
  },
  deckLinks: { display: "flex", flexDirection: "column", gap: 8 },
  deckRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    border: "1px solid var(--border-2)",
    borderRadius: 10,
    background: "var(--paper-soft)",
  },
  deckName: { flex: 1, minWidth: 0, font: "600 13px/18px var(--font-sans)", color: "var(--ink-900)" },
  deckCount: { font: "400 12px/16px var(--font-sans)", color: "var(--fg-4)" },
};
