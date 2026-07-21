"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_PDF_BYTES,
  MAX_SOURCE_FILE_BYTES,
  MAX_VIDEO_BYTES,
  type TopicSuggestion,
} from "@deephaus/shared";
import {
  DIRECT_UPLOAD_MAX_MB,
  DOCUMENT_ACCEPT,
  VIDEO_ACCEPT,
  detectSourceFileKind,
} from "@/lib/sources/file-types";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { NotionPagePicker, type NotionPageSummary } from "@/components/notion-page-picker";
import {
  GoogleDrivePicker,
  type GoogleDriveFileSummary,
} from "@/components/google-drive-picker";
import { parseYouTubeVideoId } from "@/lib/youtube/parse";
import { readJson } from "@/lib/background-tasks/api";

export type AddSourceMode =
  | "document"
  | "text"
  | "website"
  | "drive"
  | "video"
  | "youtube"
  | "notion"
  | "topic";

export type AddSourcePayload =
  | { mode: "text"; text: string }
  | { mode: "document"; file: File; extractImages: boolean }
  | { mode: "video-upload"; file: File }
  | { mode: "youtube"; url: string }
  | { mode: "website"; url: string }
  | { mode: "google-drive"; file: GoogleDriveFileSummary }
  | { mode: "notion"; page: NotionPageSummary }
  | { mode: "topic"; topic: string };

type Props = {
  open: boolean;
  projectId: string | null;
  disabled?: boolean;
  onClose: () => void;
  /**
   * Kick off the add (or topic generation). `deckName` is only meaningful when
   * the deck doesn't exist yet. Errors thrown here surface in the overlay.
   */
  onSubmit: (payload: AddSourcePayload, deckName: string) => Promise<void> | void;
  onImportApkg: () => void;
  onImportQuizlet: () => void;
};

const MAX_FILE_MB = MAX_SOURCE_FILE_BYTES / (1024 * 1024);
const MAX_PDF_MB = MAX_PDF_BYTES / (1024 * 1024);
const MAX_VIDEO_MB = MAX_VIDEO_BYTES / (1024 * 1024);
// Keep PDF uploads on the hybrid worker by default so mathematical notation is
// reconstructed by OCR instead of flattened by the legacy text-only parser.
const PDF_EXTRACTION_V2 = process.env.NEXT_PUBLIC_PDF_EXTRACTION_V2 !== "false";

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function stripFileExtension(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, "");
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base;
  return base.slice(0, dot);
}

function truncateTitle(text: string, max = 60): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

const MODE_TABS: Array<{ value: AddSourceMode; label: string; icon: string }> = [
  { value: "document", label: "Document", icon: "ri-file-upload-line" },
  { value: "notion", label: "Notion", icon: "ri-notion-line" },
  { value: "drive", label: "Drive", icon: "ri-cloud-line" },
  { value: "website", label: "Website", icon: "ri-global-line" },
  { value: "text", label: "Free Text", icon: "ri-file-text-line" },
  { value: "topic", label: "Topic", icon: "ri-lightbulb-line" },
  { value: "youtube", label: "YouTube", icon: "ri-youtube-line" },
  { value: "video", label: "Video", icon: "ri-video-line" },
];

/**
 * Overlay for attaching a new source to the deck (or generating a topic deck).
 * Replaces the old inline setup pane; opened from the sources rail's + button.
 */
export function AddSourceOverlay({
  open,
  projectId,
  disabled,
  onClose,
  onSubmit,
  onImportApkg,
  onImportQuizlet,
}: Props) {
  const [mode, setMode] = useState<AddSourceMode>("document");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [extractImages, setExtractImages] = useState(true);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [driveFile, setDriveFile] = useState<GoogleDriveFileSummary | null>(null);
  const [notionPage, setNotionPage] = useState<NotionPageSummary | null>(null);
  const [topicQuery, setTopicQuery] = useState("");
  const [topicSuggestions, setTopicSuggestions] = useState<TopicSuggestion[]>([]);
  const [topicSuggestionsLoading, setTopicSuggestionsLoading] = useState(false);
  const [customDeckName, setCustomDeckName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const isNewDeck = !projectId;

  // Reset transient state whenever the overlay reopens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
    setFile(null);
    setText("");
    setYoutubeUrl("");
    setWebsiteUrl("");
    setDriveFile(null);
    setNotionPage(null);
    setTopicQuery("");
    setCustomDeckName("");
    setMode("document");
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "topic" || topicSuggestions.length > 0) return;
    let cancelled = false;
    void (async () => {
      setTopicSuggestionsLoading(true);
      try {
        const res = await fetch("/api/generate/topic/suggestions", {
          credentials: "include",
        });
        const data = await readJson<{ suggestions: TopicSuggestion[] }>(res);
        if (!cancelled) setTopicSuggestions(data.suggestions ?? []);
      } catch {
        if (!cancelled) setTopicSuggestions([]);
      } finally {
        if (!cancelled) setTopicSuggestionsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, mode, topicSuggestions.length]);

  const suggestedDeckName = useMemo(() => {
    if (mode === "topic") return truncateTitle(topicQuery) || "Topic deck";
    if (mode === "notion") return notionPage?.title?.trim() || "Notion import";
    if (mode === "drive") return driveFile?.name?.trim() || "Google Drive import";
    if (mode === "website") {
      try {
        return new URL(websiteUrl.trim()).hostname.replace(/^www\./, "") || "Website import";
      } catch {
        return "Website import";
      }
    }
    if (mode === "youtube") return "YouTube import";
    if (file) return stripFileExtension(file.name) || "Imported deck";
    if (mode === "text") {
      const firstLine = text.trim().split(/\n/)[0] ?? "";
      return truncateTitle(firstLine) || "Text notes";
    }
    return "New deck";
  }, [mode, topicQuery, notionPage, driveFile, websiteUrl, file, text]);

  const validate = useCallback((): string | null => {
    if (mode === "text" && text.trim().length < 20) {
      return "Paste at least 20 characters of text.";
    }
    if (mode === "document") {
      if (!file) return "Choose a file to upload.";
      if (detectSourceFileKind(file.name, file.type) !== "document") {
        return "Choose a PDF, Word (.docx), PowerPoint (.pptx), or Excel (.xlsx) file.";
      }
      const hybridPdf = PDF_EXTRACTION_V2 && isPdfFile(file);
      const maxBytes = hybridPdf ? MAX_PDF_BYTES : MAX_SOURCE_FILE_BYTES;
      if (file.size > maxBytes) {
        return `File must be under ${hybridPdf ? MAX_PDF_MB : MAX_FILE_MB} MB.`;
      }
    }
    if (mode === "video") {
      if (!file) return "Choose a video to upload.";
      if (detectSourceFileKind(file.name, file.type) !== "video") {
        return "Choose a supported video file (MP4, WebM, MOV, etc.).";
      }
      if (file.size > MAX_VIDEO_BYTES) {
        return `Video must be under ${MAX_VIDEO_MB} MB.`;
      }
    }
    if (mode === "youtube" && !parseYouTubeVideoId(youtubeUrl)) {
      return "Enter a valid YouTube link (youtube.com/watch?v=… or youtu.be/…).";
    }
    if (mode === "notion" && !notionPage) {
      return "Pick a Notion page to import.";
    }
    if (mode === "drive" && !driveFile) {
      return "Pick a Google Drive file to import.";
    }
    if (mode === "website") {
      try {
        const url = new URL(websiteUrl.trim());
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      } catch {
        return "Enter a valid public website URL.";
      }
    }
    if (mode === "topic" && topicQuery.trim().length < 3) {
      return "Enter a topic (at least 3 characters).";
    }
    return null;
  }, [
    mode,
    text,
    file,
    youtubeUrl,
    websiteUrl,
    notionPage,
    driveFile,
    topicQuery,
  ]);

  const submit = useCallback(async () => {
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    const payload: AddSourcePayload =
      mode === "text"
        ? { mode: "text", text: text.trim() }
        : mode === "document"
          ? { mode: "document", file: file!, extractImages }
          : mode === "video"
            ? { mode: "video-upload", file: file! }
            : mode === "youtube"
              ? { mode: "youtube", url: youtubeUrl.trim() }
            : mode === "website"
              ? { mode: "website", url: websiteUrl.trim() }
              : mode === "drive"
                ? { mode: "google-drive", file: driveFile! }
                : mode === "notion"
                  ? { mode: "notion", page: notionPage! }
                  : { mode: "topic", topic: topicQuery.trim() };

    setSubmitting(true);
    try {
      await onSubmit(payload, customDeckName.trim() || suggestedDeckName);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the source.");
    } finally {
      setSubmitting(false);
    }
  }, [
    validate,
    mode,
    text,
    file,
    extractImages,
    youtubeUrl,
    websiteUrl,
    driveFile,
    notionPage,
    topicQuery,
    customDeckName,
    suggestedDeckName,
    onSubmit,
    onClose,
  ]);

  if (!open) return null;

  const busy = submitting || Boolean(disabled);
  const submitLabel = mode === "topic" ? "Generate cards" : "Add source";

  return (
    <AnimatedModal title="Add source" onClose={busy ? () => undefined : onClose} maxWidth={760}>
      <div style={s.body}>
        <div style={s.tabs}>
          {MODE_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => {
                setMode(tab.value);
                setError(null);
              }}
              style={{ ...s.tabBtn, ...(mode === tab.value ? s.tabBtnActive : {}) }}
            >
              <i className={tab.icon} aria-hidden />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Let each source method determine the overlay's vertical size. */}
        <div style={s.modePanel}>
          {mode === "text" ? (
            <div className="field" style={s.modeField}>
              <label className="field-label" htmlFor="add-source-text">
                Paste notes, transcripts, or any text
              </label>
              <textarea
                id="add-source-text"
                className="textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste your source material here…"
                style={s.textArea}
              />
              <span style={s.hint}>{text.length.toLocaleString()} characters</span>
            </div>
          ) : null}

          {mode === "website" ? (
            <div className="field" style={s.modeField}>
              <label className="field-label" htmlFor="add-source-website">
                Public webpage URL
              </label>
              <input
                id="add-source-website"
                className="input"
                type="url"
                value={websiteUrl}
                onChange={(event) => setWebsiteUrl(event.target.value)}
                placeholder="https://example.com/article"
                autoComplete="url"
              />
              <span style={{ ...s.hint, display: "block", marginTop: 8 }}>
                DeepHaus imports the main readable content from this page. Sign-in-only pages and
                whole-site crawling aren&apos;t supported.
              </span>
            </div>
          ) : null}

          {mode === "drive" ? (
            <div className="field" style={s.modeField}>
              <span className="field-label">Google Drive file</span>
              <GoogleDrivePicker
                returnTo={projectId ? `/create?deck=${projectId}` : "/create"}
                selectedFile={driveFile}
                onSelect={setDriveFile}
                disabled={busy}
              />
            </div>
          ) : null}

          {mode === "document" ? (
            <div className="field" style={s.modeField}>
              <span className="field-label">PDF, Word, PowerPoint, or Excel</span>
              <input
                ref={documentInputRef}
                type="file"
                accept={DOCUMENT_ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
                tabIndex={-1}
              />
              <button
                type="button"
                style={s.dropzoneBtn}
                onClick={() => documentInputRef.current?.click()}
              >
                <i
                  className="ri-upload-cloud-2-line"
                  style={{ fontSize: 28, color: "var(--ink-400)" }}
                  aria-hidden
                />
                <span style={s.dropzoneTitle}>{file ? file.name : "Click to choose a file"}</span>
                <span style={s.hint}>
                  PDF, .docx, .pptx, .xlsx · up to {PDF_EXTRACTION_V2 ? MAX_PDF_MB : MAX_FILE_MB} MB
                  {!PDF_EXTRACTION_V2
                    ? ` · files over ${DIRECT_UPLOAD_MAX_MB} MB upload via storage`
                    : ""}
                </span>
              </button>
              <label style={s.extractImagesRow}>
                <input
                  type="checkbox"
                  checked={extractImages}
                  onChange={(e) => setExtractImages(e.target.checked)}
                  style={{ flexShrink: 0 }}
                />
                <span>
                  Extract images into notes
                  <span style={{ ...s.hint, display: "block" }}>
                    Figures and diagrams appear alongside the text, in place.
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          {mode === "video" ? (
            <div className="field" style={s.modeField}>
              <input
                ref={videoInputRef}
                type="file"
                accept={VIDEO_ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                style={{ display: "none" }}
                tabIndex={-1}
              />
              <button
                type="button"
                style={s.dropzoneBtn}
                onClick={() => videoInputRef.current?.click()}
              >
                <i
                  className="ri-film-line"
                  style={{ fontSize: 28, color: "var(--ink-400)" }}
                  aria-hidden
                />
                <span style={s.dropzoneTitle}>
                  {file ? file.name : "Click to choose a video"}
                </span>
                <span style={s.hint}>MP4, WebM, MOV · up to {MAX_VIDEO_MB} MB</span>
              </button>
              <span style={{ ...s.hint, display: "block", marginTop: 8 }}>
                Speech is transcribed with Whisper, then turned into flashcards.
              </span>
            </div>
          ) : null}

          {mode === "youtube" ? (
            <div className="field" style={s.modeField}>
              <label className="field-label" htmlFor="add-source-youtube">
                YouTube URL
              </label>
              <input
                id="add-source-youtube"
                className="input"
                type="url"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=…"
                autoComplete="url"
              />
              <span style={{ ...s.hint, display: "block", marginTop: 8 }}>
                Uses the video&apos;s captions (manual or auto-generated). Videos
                without subtitles cannot be used.
              </span>
            </div>
          ) : null}

          {mode === "notion" ? (
            <div className="field" style={s.modeField}>
              <span className="field-label">Notion page</span>
              <NotionPagePicker
                returnTo={projectId ? `/create?deck=${projectId}` : "/create"}
                selectedPageId={notionPage?.id ?? null}
                onSelect={(page) => setNotionPage(page)}
                disabled={busy}
              />
            </div>
          ) : null}

          {mode === "topic" ? (
            <div className="field" style={s.modeField}>
              <label className="field-label" htmlFor="add-source-topic">
                What should the cards cover?
              </label>
              <span style={s.hint}>
                Topic decks generate immediately from what the model knows — no
                source document is stored.
              </span>
              <input
                id="add-source-topic"
                className="input"
                value={topicQuery}
                onChange={(e) => setTopicQuery(e.target.value)}
                placeholder="e.g. heart failure guidelines, flags of the world"
              />
              {topicSuggestionsLoading ? (
                <span style={s.hint}>Loading suggestions…</span>
              ) : topicSuggestions.length > 0 ? (
                <div style={s.topicChipRow}>
                  {topicSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onClick={() => setTopicQuery(suggestion.query)}
                      style={{
                        ...s.topicChip,
                        ...(topicQuery === suggestion.query ? s.topicChipActive : {}),
                      }}
                    >
                      {suggestion.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {isNewDeck ? (
          <div className="field">
            <label className="field-label" htmlFor="add-source-deck-name">
              Deck name
            </label>
            <input
              id="add-source-deck-name"
              className="input"
              value={customDeckName}
              onChange={(e) => setCustomDeckName(e.target.value)}
              placeholder={suggestedDeckName}
            />
            <span style={s.hint}>Leave blank to use the suggested name.</span>
          </div>
        ) : null}

        {error ? (
          <div style={s.error} role="alert">
            <i className="ri-error-warning-line" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <div style={s.footer}>
          <div style={s.importActions}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                onClose();
                onImportApkg();
              }}
              disabled={busy}
            >
              <i className="ri-folder-download-line" aria-hidden />
              Anki
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                onClose();
                onImportQuizlet();
              }}
              disabled={busy}
            >
              <i className="ri-file-copy-2-line" aria-hidden />
              Quizlet
            </button>
          </div>
          <div style={s.footerActions}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={busy}
            >
              {submitting ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </AnimatedModal>
  );
}

const s: Record<string, React.CSSProperties> = {
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  tabs: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    padding: 3,
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 8,
    gap: 3,
    flexShrink: 0,
  },
  tabBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 6,
    width: "100%",
    padding: "7px 13px",
    background: "transparent",
    color: "var(--ink-500)",
    border: "1px solid transparent",
    borderRadius: 6,
    font: "500 13px/16px var(--font-sans)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  tabBtnActive: {
    background: "var(--white)",
    color: "var(--ink-900)",
    border: "1px solid var(--border-secondary)",
  },
  modePanel: {
    display: "flex",
    flexDirection: "column",
  },
  modeField: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
  },
  textArea: {
    flex: 1,
    minHeight: 160,
    resize: "none",
  },
  hint: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
  dropzoneBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    flex: 1,
    minHeight: 140,
    padding: "28px 16px",
    border: "1px dashed var(--border-1)",
    borderRadius: 8,
    background: "var(--paper-soft)",
    cursor: "pointer",
    textAlign: "center",
  },
  dropzoneTitle: {
    color: "var(--ink-700)",
    font: "500 14px/20px var(--font-sans)",
  },
  extractImagesRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 10,
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-2)",
    cursor: "pointer",
  },
  topicChipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  topicChip: {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid var(--border-2)",
    background: "var(--white)",
    color: "var(--ink-800)",
    font: "500 12px/16px var(--font-sans)",
    cursor: "pointer",
  },
  topicChipActive: {
    border: "1px solid var(--teal-500)",
    background: "var(--brand-25)",
    color: "var(--ink-900)",
  },
  error: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--grade-again-bg)",
    border: "1px solid rgba(217, 45, 32, 0.32)",
    color: "var(--grade-again)",
    font: "500 13px/18px var(--font-sans)",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 4,
    flexWrap: "wrap",
  },
  importActions: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  footerActions: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginLeft: "auto",
  },
};
