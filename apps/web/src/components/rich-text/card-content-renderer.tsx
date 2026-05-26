"use client";

import {
  markdownToRichText,
  normalizeEditorValue,
  richTextToHtmlWithClozeMode,
  type CardRichTextContent,
  type ClozeRenderMode,
} from "@deephaus/rich-text";
import { memo, useMemo, type CSSProperties } from "react";
import "./rich-text.css";

export type CardContentRendererProps = {
  content: string | CardRichTextContent | null | undefined;
  /** hidden = cloze blanks, revealed = show cloze text, none = ignore clozes */
  clozeMode?: ClozeRenderMode;
  /** When set in hidden mode, only this cloze ordinal (c1 → 1) is blanked. */
  activeClozeOrd?: number | null;
  /** Study/review view: hide c1/c2 badges, show colored blanks only. */
  studyView?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * Read-only card renderer.
 * HTML is generated from structured JSON and sanitized in @deephaus/rich-text
 * before insertion. Only sanitized output is passed to dangerouslySetInnerHTML.
 */
export const CardContentRenderer = memo(function CardContentRenderer({
  content,
  clozeMode = "none",
  activeClozeOrd,
  studyView = false,
  className,
  style,
}: CardContentRendererProps) {
  const html = useMemo(() => {
    if (!content) return "";
    const normalized =
      typeof content === "string" ? markdownToRichText(content) : normalizeEditorValue(content);
    const ord = activeClozeOrd != null && activeClozeOrd > 0 ? activeClozeOrd : undefined;
    return richTextToHtmlWithClozeMode(normalized.json, clozeMode, ord);
  }, [content, clozeMode, activeClozeOrd]);

  if (!html) return null;

  return (
    <div
      className={`dh-card-content-renderer${clozeMode === "hidden" ? " is-hidden" : ""}${clozeMode === "revealed" ? " is-revealed" : ""}${studyView ? " is-study" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      // Safe: HTML is generated from our Tiptap schema then allowlist-sanitized.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
