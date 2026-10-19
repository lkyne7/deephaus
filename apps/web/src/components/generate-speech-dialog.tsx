"use client";

import { DEFAULT_TTS_VOICE, MAX_TTS_CHARS, TTS_VOICES, cardTextForSpeech } from "@deephaus/shared";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  cardId: string;
  fieldLabel: string;
  /** The field's current markup; the dialog shows the words that will be read. */
  initialText: string;
  /** Called with the stored clip; the dialog closes afterwards. */
  onGenerated: (clip: { url: string; title: string }) => void | Promise<void>;
};

const VOICE_STORAGE_KEY = "deephaus.ttsVoice";
const LANGUAGE_STORAGE_KEY = "deephaus.ttsLanguage";

function readStored(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore quota / private mode errors.
  }
}

/** Turn a field's text into a spoken clip with OpenAI text-to-speech. */
export function GenerateSpeechDialog({ open, onClose, cardId, fieldLabel, initialText, onGenerated }: Props) {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<string>(DEFAULT_TTS_VOICE);
  const [language, setLanguage] = useState("");
  const [title, setTitle] = useState("Pronunciation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText(cardTextForSpeech(initialText));
    setVoice(readStored(VOICE_STORAGE_KEY, DEFAULT_TTS_VOICE));
    setLanguage(readStored(LANGUAGE_STORAGE_KEY, ""));
    setTitle("Pronunciation");
    setError(null);
    setBusy(false);
  }, [open, initialText]);

  const spoken = useMemo(() => cardTextForSpeech(text), [text]);
  const credits = Math.max(1, Math.ceil(spoken.length / 1000));
  const tooLong = spoken.length > MAX_TTS_CHARS;

  async function generate() {
    if (!spoken || tooLong) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/cards/${cardId}/speech`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ text: spoken, voice, language: language.trim() || undefined, title: title.trim() || undefined }),
      });
      const body = (await res.json().catch(() => null)) as { url?: string; title?: string; error?: string } | null;
      if (!res.ok || !body?.url) {
        throw new Error(body?.error ?? (res.status === 402 ? "You're out of AI credits." : `Could not generate speech (${res.status}).`));
      }
      writeStored(VOICE_STORAGE_KEY, voice);
      writeStored(LANGUAGE_STORAGE_KEY, language.trim());
      await onGenerated({ url: body.url, title: body.title ?? title });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate speech.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div style={s.overlay} role="presentation" onClick={busy ? undefined : onClose}>
      <div style={s.card} role="dialog" aria-modal="true" aria-label="Generate speech" onClick={(event) => event.stopPropagation()}>
        <div style={s.header}>
          <i className="ri-voiceprint-line" aria-hidden style={{ fontSize: 20, color: "var(--ink-500)" }} />
          <h2 style={s.title}>Generate speech for the {fieldLabel.toLowerCase()}</h2>
        </div>

        <label style={s.label}>
          Text to read
          <textarea
            className="input"
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            style={s.textarea}
            disabled={busy}
          />
          <span style={{ ...s.hint, color: tooLong ? "var(--grade-again)" : "var(--ink-500)" }}>
            {spoken.length} / {MAX_TTS_CHARS} characters · {credits} credit{credits === 1 ? "" : "s"}
          </span>
        </label>

        <div style={s.row}>
          <label style={{ ...s.label, flex: 1 }}>
            Voice
            <select className="input" value={voice} onChange={(event) => setVoice(event.target.value)} disabled={busy}>
              {TTS_VOICES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ ...s.label, flex: 1 }}>
            Language (optional)
            <input
              className="input"
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              placeholder="e.g. French"
              disabled={busy}
            />
          </label>
        </div>
        <label style={s.label}>
          Clip label
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
        </label>

        {error ? <div className="notice notice-error">{error}</div> : null}

        <div style={s.actions}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void generate()} disabled={busy || !spoken || tooLong}>
            {busy ? "Generating…" : "Generate clip"}
          </button>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  overlay: { position: "fixed", inset: 0, background: "var(--bg-overlay)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 120 },
  card: { width: "100%", maxWidth: 480, background: "var(--white)", border: "1px solid var(--border-2)", borderRadius: 12, boxShadow: "var(--shadow-xl)", padding: 20, display: "flex", flexDirection: "column", gap: 14 },
  header: { display: "flex", alignItems: "center", gap: 10 },
  title: { margin: 0, font: "600 16px/1.3 var(--font-sans)", color: "var(--ink-900)" },
  label: { display: "flex", flexDirection: "column", gap: 6, font: "500 12px/16px var(--font-sans)", color: "var(--ink-600)" },
  textarea: { resize: "vertical", font: "400 14px/1.5 var(--font-sans)" },
  hint: { font: "400 12px/16px var(--font-sans)" },
  row: { display: "flex", gap: 12 },
  actions: { display: "flex", justifyContent: "flex-end", gap: 8 },
};
