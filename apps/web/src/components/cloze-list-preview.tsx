"use client";

import { clozeClassName } from "@deephaus/rich-text";
import { useMemo } from "react";
import "@/components/rich-text/rich-text.css";

type Segment =
  | { kind: "text"; text: string }
  | { kind: "blank"; id: string; text: string };

const CLOZE_TOKEN = /\{\{c(\d+)::([\s\S]*?)\}\}/g;

/** Drop embedded media so the preview is a single readable line of text. */
function stripMedia(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ");
}

function parseSegments(raw: string): Segment[] {
  const text = stripMedia(raw);
  const segments: Segment[] = [];
  let lastIndex = 0;
  CLOZE_TOKEN.lastIndex = 0;
  for (const match of text.matchAll(CLOZE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ kind: "text", text: text.slice(lastIndex, index) });
    }
    // `{{c1::answer::hint}}` — show the answer; the hint stays editor-only.
    const inner = match[2] ?? "";
    const answer = inner.split("::")[0] ?? inner;
    segments.push({ kind: "blank", id: `c${match[1]}`, text: answer });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return segments;
}

/**
 * Renders cloze text for list rows with each deletion as a colored blank
 * (matching the cloze palette used in the editor and study views).
 */
export function ClozeListPreview({ text }: { text: string }) {
  const segments = useMemo(() => parseSegments(text), [text]);
  return (
    <span className="dh-cloze-list-preview">
      {segments.map((segment, index) =>
        segment.kind === "blank" ? (
          <span key={index} className={clozeClassName(segment.id)}>
            {segment.text.replace(/\s+/g, " ").trim()}
          </span>
        ) : (
          <span key={index}>{segment.text.replace(/\s+/g, " ")}</span>
        ),
      )}
    </span>
  );
}
