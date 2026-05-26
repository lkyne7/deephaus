import type { JSONContent } from "@tiptap/core";

/** Canonical persisted card field payload from {@link InlineCardEditor}. */
export type CardRichTextContent = {
  /** Tiptap / ProseMirror document JSON. Source of truth for round-trips. */
  json: JSONContent;
  /** Sanitized HTML snapshot for fast read-only rendering. */
  html: string;
  /** Markdown with Anki cloze syntax and $...$ / $$...$$ LaTeX preserved. */
  markdown: string;
  /** Plain text for search, previews, and legacy fallbacks. */
  plainText: string;
};

export type ClozeRenderMode = "hidden" | "revealed" | "none";
