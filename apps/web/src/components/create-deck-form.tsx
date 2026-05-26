"use client";

import { AnimatePresence, m } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_PDF_BYTES } from "@deephaus/shared";

type Source = "text" | "pdf";

const MAX_MB = MAX_PDF_BYTES / (1024 * 1024);

export function CreateDeckForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [source, setSource] = useState<Source>("text");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [density, setDensity] = useState(5);
  const [cardMix, setCardMix] = useState<"basic" | "cloze" | "both">("both");
  const [focusPrompt, setFocusPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function readJson<T>(res: Response): Promise<T> {
    const body = await res.text();
    if (!res.ok) {
      try {
        const json = JSON.parse(body) as { error?: string };
        throw new Error(json.error ?? body);
      } catch (e) {
        if (e instanceof Error && e.message !== body) throw e;
        throw new Error(body || `Request failed (${res.status})`);
      }
    }
    return JSON.parse(body) as T;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (!name.trim()) throw new Error("Give your deck a name.");
      if (source === "text" && text.trim().length < 20) {
        throw new Error("Paste at least 20 characters of text.");
      }
      if (source === "pdf" && !file) {
        throw new Error("Pick a PDF to upload.");
      }
      if (file && file.size > MAX_PDF_BYTES) {
        throw new Error(`PDF must be under ${MAX_MB} MB.`);
      }

      const settings = {
        cardMix,
        density,
        focusPrompt: focusPrompt.trim() || undefined,
      };

      setStatus("Creating deck…");
      const projectRes = await fetch("/api/projects", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), deck_name: name.trim(), settings }),
      });
      const project = await readJson<{ id: string }>(projectRes);

      if (source === "text") {
        setStatus("Generating cards from your text…");
        const res = await fetch("/api/generate/text", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project_id: project.id, text: text.trim(), settings }),
        });
        await readJson<unknown>(res);
      } else {
        setStatus("Uploading and extracting your PDF…");
        const form = new FormData();
        form.append("project_id", project.id);
        form.append("file", file!, file!.name);
        const sourceRes = await fetch("/api/sources/pdf", {
          method: "POST",
          credentials: "include",
          body: form,
        });
        const sourceData = await readJson<{ id: string }>(sourceRes);

        setStatus("Generating cards from your PDF…");
        const genRes = await fetch("/api/generate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_id: sourceData.id, settings }),
        });
        await readJson<unknown>(genRes);
      }

      router.push(`/decks/${project.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
      setStatus("");
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="surface" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        <div className="field">
          <label className="field-label" htmlFor="deck-name">
            Deck name
          </label>
          <input
            id="deck-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter deck name"
            autoFocus
          />
        </div>

        <div>
          <div className="field-label" style={{ marginBottom: 10 }}>
            Source
          </div>
          <div style={tab.wrap}>
            <button
              type="button"
              onClick={() => setSource("text")}
              style={{ ...tab.btn, ...(source === "text" ? tab.btnActive : {}) }}
            >
              <i className="ri-file-text-line" />
              Paste text
            </button>
            <button
              type="button"
              onClick={() => setSource("pdf")}
              style={{ ...tab.btn, ...(source === "pdf" ? tab.btnActive : {}) }}
            >
              <i className="ri-file-pdf-2-line" />
              Upload PDF
            </button>
          </div>
        </div>

        {source === "text" ? (
          <div className="field">
            <label className="field-label" htmlFor="text">
              Paste your notes, transcript, or any text
            </label>
            <textarea
              id="text"
              className="textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste your notes here. The more context DeepHaus has, the better the cards."
              style={{ minHeight: 240 }}
            />
            <span style={{ font: "400 12px/18px var(--font-sans)", color: "var(--fg-4)" }}>
              {text.length.toLocaleString()} characters
            </span>
          </div>
        ) : (
          <div className="field">
            <label className="field-label" htmlFor="pdf">
              PDF file
            </label>
            <label
              htmlFor="pdf"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "32px 16px",
                border: "1px dashed var(--border-1)",
                borderRadius: 12,
                background: "var(--paper-soft)",
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              <i className="ri-upload-cloud-2-line" style={{ fontSize: 28, color: "var(--ink-400)" }} />
              <span style={{ color: "var(--ink-700)", font: "500 14px/20px var(--font-sans)" }}>
                {file ? file.name : "Click to choose a PDF"}
              </span>
              <span style={{ color: "var(--fg-4)", font: "400 12px/18px var(--font-sans)" }}>
                Up to {MAX_MB} MB
              </span>
              <input
                id="pdf"
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
              />
            </label>
          </div>
        )}
      </div>

      <div className="surface" style={{ padding: 28, display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <h3 style={{ font: "500 16px/24px var(--font-sans)", color: "var(--ink-900)", margin: 0 }}>Settings</h3>
          <p style={{ font: "400 13px/20px var(--font-sans)", color: "var(--fg-4)", margin: "4px 0 0" }}>
            Tune how DeepHaus writes your cards.
          </p>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="density">
            Cards per 1,000 words ({density})
          </label>
          <input
            id="density"
            type="range"
            min={1}
            max={15}
            value={density}
            onChange={(e) => setDensity(Number(e.target.value))}
            style={{ accentColor: "var(--teal-500)" }}
          />
        </div>

        <div className="field">
          <span className="field-label">Card types</span>
          <div style={{ display: "flex", gap: 8 }}>
            {(["both", "basic", "cloze"] as const).map((mix) => (
              <button
                key={mix}
                type="button"
                onClick={() => setCardMix(mix)}
                style={{
                  ...tab.btn,
                  flex: "0 1 auto",
                  ...(cardMix === mix ? tab.btnActive : {}),
                }}
              >
                {mix === "both" ? "Both" : mix === "basic" ? "Basic" : "Cloze"}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="focus">
            Focus prompt (optional)
          </label>
          <input
            id="focus"
            className="input"
            value={focusPrompt}
            onChange={(e) => setFocusPrompt(e.target.value)}
            placeholder="e.g. exam prep, definitions only, key formulas"
          />
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center" }}>
        <AnimatePresence mode="wait">
          {status && (
            <m.span
              key={status}
              style={{ color: "var(--fg-4)", font: "400 13px/20px var(--font-sans)", marginRight: "auto" }}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 6 }}
              transition={{ duration: 0.18 }}
            >
              {status}
            </m.span>
          )}
        </AnimatePresence>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Generating…" : "Create Deck"}
        </button>
      </div>
    </form>
  );
}

const tab = {
  wrap: {
    display: "inline-flex",
    padding: 4,
    background: "var(--ink-25)",
    borderRadius: 9999,
    gap: 4,
  } as React.CSSProperties,
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 16px",
    background: "transparent",
    color: "var(--ink-500)",
    border: 0,
    borderRadius: 9999,
    font: "500 13px/16px var(--font-sans)",
    cursor: "pointer",
  } as React.CSSProperties,
  btnActive: {
    background: "var(--white)",
    color: "var(--ink-900)",
    boxShadow: "var(--shadow-xs)",
  } as React.CSSProperties,
};
