"use client";

import {
  markdownToRichText,
  normalizeEditorValue,
  richTextToHtmlWithClozeMode,
  type CardRichTextContent,
  type ClozeRenderMode,
} from "@deephaus/rich-text";
import {
  cardMediaDisplayUrlSized,
  parseCardContent,
  type CardMediaDisplaySize,
} from "@deephaus/shared";
import { memo, useMemo, type CSSProperties } from "react";
import "./rich-text.css";

type RenderPart =
  | { type: "html"; html: string }
  | { type: "image"; src: string; alt: string };

export type CardContentRendererProps = {
  content: string | CardRichTextContent | null | undefined;
  /** hidden = cloze blanks, revealed = show cloze text, none = ignore clozes */
  clozeMode?: ClozeRenderMode;
  /** When set in hidden mode, only this cloze ordinal (c1 → 1) is blanked. */
  activeClozeOrd?: number | null;
  /** Study/review view: hide c1/c2 badges, show colored blanks only. */
  studyView?: boolean;
  /** Resize card-media images via Supabase transforms (Pro). */
  mediaSize?: CardMediaDisplaySize;
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
  mediaSize = studyView ? "study" : "preview",
  className,
  style,
}: CardContentRendererProps) {
  const parts = useMemo<RenderPart[]>(() => {
    if (!content) return [];
    const ord = activeClozeOrd != null && activeClozeOrd > 0 ? activeClozeOrd : undefined;

    // Object content comes from the editor (no image nodes yet) — render as one block.
    if (typeof content !== "string") {
      const html = richTextToHtmlWithClozeMode(normalizeEditorValue(content).json, clozeMode, ord);
      return html ? [{ type: "html", html }] : [];
    }

    // String content may embed image markdown (`![](url)`) or <img> tags that the
    // Tiptap pipeline strips. Split those out so images render alongside rich text.
    return parseCardContent(content).flatMap<RenderPart>((segment) => {
      if (segment.type === "image") {
        return [
          {
            type: "image",
            src: cardMediaDisplayUrlSized(segment.src, mediaSize),
            alt: segment.alt,
          },
        ];
      }
      const html = richTextToHtmlWithClozeMode(
        markdownToRichText(segment.value).json,
        clozeMode,
        ord,
      );
      return html ? [{ type: "html", html }] : [];
    });
  }, [content, clozeMode, activeClozeOrd, mediaSize]);

  if (parts.length === 0) return null;

  return (
    <div
      className={`dh-card-content-renderer${clozeMode === "hidden" ? " is-hidden" : ""}${clozeMode === "revealed" ? " is-revealed" : ""}${studyView ? " is-study" : ""}${className ? ` ${className}` : ""}`}
      style={style}
    >
      {parts.map((part, index) =>
        part.type === "image" ? (
          // Card images are user-uploaded URLs from our storage bucket.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={index}
            src={part.src}
            alt={part.alt}
            className="dh-card-content-renderer__image"
            loading="lazy"
          />
        ) : (
          <div
            key={index}
            className="dh-card-content-renderer__html"
            // Safe: HTML is generated from our Tiptap schema then allowlist-sanitized.
            dangerouslySetInnerHTML={{ __html: part.html }}
          />
        ),
      )}
    </div>
  );
});
