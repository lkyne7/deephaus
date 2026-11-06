"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { GoogleDrivePicker } from "@/components/google-drive-picker";
import { NotionPagePicker } from "@/components/notion-page-picker";
import { parseYouTubeVideoId } from "@/lib/youtube/parse";
import {
  MIN_SOURCE_TEXT_CHARS,
  attachmentFromUrl,
  newAttachmentId,
  type ComposerAttachment,
} from "@/components/create/composer-sources";

/** Sources that need one more piece of input before they can be attached. */
export type ComposerSourceDialogMode = "text" | "website" | "youtube" | "notion" | "drive";

type Props = {
  mode: ComposerSourceDialogMode | null;
  /** Where OAuth connect flows (Notion, Drive) should return to. */
  returnTo: string;
  onClose: () => void;
  onAttach: (attachment: ComposerAttachment) => void;
};

const TITLES: Record<ComposerSourceDialogMode, string> = {
  text: "Paste text or notes",
  website: "Add a website",
  youtube: "Add a YouTube video",
  notion: "Add a Notion page",
  drive: "Add a Google Drive file",
};

/**
 * Small follow-up dialog for composer sources that can't be picked from the
 * file system: pasted text, links, and Notion / Drive pickers.
 */
export function ComposerSourceDialog({ mode, returnTo, onClose, onAttach }: Props) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Start clean each time the dialog opens for a source type.
  useEffect(() => {
    if (!mode) return;
    setText("");
    setUrl("");
    setError(null);
    const id = window.requestAnimationFrame(() => {
      if (mode === "text") textRef.current?.focus();
      else inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [mode]);

  if (!mode) return null;

  function attach(attachment: ComposerAttachment) {
    onAttach(attachment);
    onClose();
  }

  function submit() {
    setError(null);
    if (mode === "text") {
      const value = text.trim();
      if (value.length < MIN_SOURCE_TEXT_CHARS) {
        setError(`Paste at least ${MIN_SOURCE_TEXT_CHARS} characters of text.`);
        return;
      }
      attach({ id: newAttachmentId(), kind: "text", text: value });
      return;
    }
    if (mode === "youtube") {
      if (!parseYouTubeVideoId(url)) {
        setError("Enter a valid YouTube link (youtube.com/watch?v=… or youtu.be/…).");
        return;
      }
      attach({ id: newAttachmentId(), kind: "youtube", url: url.trim() });
      return;
    }
    if (mode === "website") {
      const attachment = attachmentFromUrl(url);
      if (!attachment) {
        setError("Enter a valid public website URL.");
        return;
      }
      attach(attachment);
    }
  }

  return (
    <AnimatedModal
      title={TITLES[mode]}
      onClose={onClose}
      maxWidth={mode === "text" ? 640 : 520}
      closeOnEscape
    >
      <form
        style={s.body}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {mode === "text" ? (
          <div className="field">
            <textarea
              ref={textRef}
              className="textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Paste notes, a transcript, or any text to make cards from…"
              aria-label="Source text"
              style={s.textArea}
            />
            <span style={s.hint}>{text.length.toLocaleString()} characters</span>
          </div>
        ) : null}

        {mode === "website" ? (
          <div className="field">
            <input
              ref={inputRef}
              className="input"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/article"
              autoComplete="url"
              aria-label="Website URL"
            />
            <span style={s.hint}>
              DeepHaus imports the main readable content from this page. Sign-in-only pages and
              whole-site crawling aren&apos;t supported.
            </span>
          </div>
        ) : null}

        {mode === "youtube" ? (
          <div className="field">
            <input
              ref={inputRef}
              className="input"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              autoComplete="url"
              aria-label="YouTube URL"
            />
            <span style={s.hint}>
              Uses the video&apos;s captions (manual or auto-generated). Videos without subtitles
              cannot be used.
            </span>
          </div>
        ) : null}

        {mode === "notion" ? (
          <NotionPagePicker
            returnTo={returnTo}
            selectedPageId={null}
            onSelect={(page) => attach({ id: newAttachmentId(), kind: "notion", page })}
          />
        ) : null}

        {mode === "drive" ? (
          <GoogleDrivePicker
            returnTo={returnTo}
            onSelect={(file) => attach({ id: newAttachmentId(), kind: "drive", file })}
          />
        ) : null}

        {error ? (
          <div className="notice notice-error dhc-notice" role="alert">
            <i className="ri-error-warning-line" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {mode !== "notion" && mode !== "drive" ? (
          <div style={s.actions}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Add source
            </button>
          </div>
        ) : null}
      </form>
    </AnimatedModal>
  );
}

const s: Record<string, React.CSSProperties> = {
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  textArea: {
    minHeight: 220,
    resize: "vertical",
  },
  hint: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  },
};
