import type { JSONContent } from "@tiptap/core";
import { generateHTML } from "@tiptap/core";
import { getSourceDocumentExtensions } from "../extensions/source-document.js";
import { sanitizeCardHtml } from "./sanitize.js";

const extensions = getSourceDocumentExtensions();

/** Render a source document to sanitized HTML for read-only previews. */
export function sourceDocToHtml(json: JSONContent): string {
  return sanitizeCardHtml(generateHTML(json, extensions));
}

export function emptySourceDoc(): JSONContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

export function isEmptySourceDoc(json: JSONContent | null | undefined): boolean {
  if (!json || !Array.isArray(json.content)) return true;
  return sourceDocToPlainText(json).trim().length === 0;
}

/**
 * Flatten a source document to plain text. Page/slide heading markers are
 * preserved as `--- Page N ---` / `--- Slide N ---` lines so downstream chunking
 * (which splits on those markers) keeps mapping cards to the right page.
 */
export function sourceDocToPlainText(json: JSONContent): string {
  const lines: string[] = [];

  function inlineText(node: JSONContent): string {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "latexInline") return `$${String(node.attrs?.formula ?? "")}$`;
    if (node.type === "latexBlock") return `$$${String(node.attrs?.formula ?? "")}$$`;
    if (node.type === "hardBreak") return "\n";
    return (node.content ?? []).map(inlineText).join("");
  }

  function pageMarker(text: string): string | null {
    const match = text.trim().match(/^(page|slide)\s+(\d+)$/i);
    if (!match) return null;
    const unit = match[1]!.toLowerCase() === "slide" ? "Slide" : "Page";
    return `--- ${unit} ${match[2]} ---`;
  }

  function walkBlock(node: JSONContent) {
    switch (node.type) {
      case "heading": {
        const text = (node.content ?? []).map(inlineText).join("").trim();
        if (!text) return;
        lines.push(pageMarker(text) ?? text);
        return;
      }
      case "paragraph": {
        const text = (node.content ?? []).map(inlineText).join("").trim();
        if (text) lines.push(text);
        return;
      }
      case "bulletList":
      case "orderedList": {
        for (const item of node.content ?? []) {
          const text = (item.content ?? []).map(inlineText).join("").trim();
          if (text) lines.push(`- ${text}`);
        }
        return;
      }
      case "blockquote": {
        const text = (node.content ?? []).map(inlineText).join("").trim();
        if (text) lines.push(text);
        return;
      }
      case "image":
        return; // images carry no text
      case "table": {
        const rows = (node.content ?? [])
          .map((row) =>
            (row.content ?? [])
              .map((cell) => (cell.content ?? []).map(inlineText).join("").trim())
              .join("\t"),
          )
          .filter(Boolean);
        if (rows.length) lines.push(rows.join("\n"));
        return;
      }
      default: {
        const text = (node.content ?? []).map(inlineText).join("").trim();
        if (text) lines.push(text);
      }
    }
  }

  (json.content ?? []).forEach(walkBlock);
  return lines.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
