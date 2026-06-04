import { clozeHintPlaceholder } from "@deephaus/shared";
import type { JSONContent } from "@tiptap/core";
import { generateHTML, generateJSON } from "@tiptap/core";
import { getCardEditorExtensions } from "../extensions/index.js";
import { injectKatexIntoHtml } from "./inject-katex.js";
import { sanitizeCardHtml } from "./sanitize.js";

const extensions = getCardEditorExtensions();

export { sanitizeCardHtml } from "./sanitize.js";

export function richTextToHtml(json: JSONContent): string {
  const raw = generateHTML(json, extensions);
  const withLatex = injectKatexIntoHtml(raw);
  return sanitizeCardHtml(withLatex);
}

export function htmlToRichTextJson(html: string): JSONContent {
  return generateJSON(html, extensions);
}

export function emptyRichTextDoc(): JSONContent {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

export function isEmptyRichTextDoc(json: JSONContent | null | undefined): boolean {
  if (!json) return true;
  return richTextToPlainTextWithClozeMode(json, "none").trim().length === 0;
}

export function richTextToPlainText(json: JSONContent): string {
  return richTextToPlainTextWithClozeMode(json, "none");
}

export function richTextToPlainTextWithClozeMode(
  json: JSONContent,
  clozeMode: "hidden" | "revealed" | "none",
  activeClozeOrd?: number,
): string {
  const hideAll = clozeMode === "hidden" && activeClozeOrd == null;
  const parts: string[] = [];

  function clozeOrdFromMark(mark: { attrs?: Record<string, unknown> }): number {
    const id = String(mark.attrs?.id ?? "c1");
    const n = Number.parseInt(id.replace(/^c/i, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function blankPlaceholder(mark: { attrs?: Record<string, unknown> }): string {
    const hint = mark.attrs?.hint;
    return clozeHintPlaceholder(hint == null ? null : String(hint));
  }

  function walk(node: JSONContent) {
    if (node.type === "text") {
      const cloze = node.marks?.find((mark) => mark.type === "cloze");
      if (cloze && clozeMode === "hidden") {
        const ord = clozeOrdFromMark(cloze);
        if (hideAll || ord === activeClozeOrd) {
          parts.push(blankPlaceholder(cloze));
          return;
        }
      }
      parts.push(node.text ?? "");
      return;
    }
    if (node.type === "latexInline") {
      parts.push(`$${String(node.attrs?.formula ?? "")}$`);
      return;
    }
    if (node.type === "latexBlock") {
      parts.push(`\n$$${String(node.attrs?.formula ?? "")}$$\n`);
      return;
    }
    if (node.type === "hardBreak") {
      parts.push("\n");
      return;
    }
    if (node.type === "paragraph" || node.type === "heading") {
      node.content?.forEach(walk);
      parts.push("\n");
      return;
    }
    node.content?.forEach(walk);
  }

  json.content?.forEach(walk);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

export function applyClozeModeToJson(
  json: JSONContent,
  mode: "hidden" | "revealed" | "none",
  activeClozeOrd?: number,
): JSONContent {
  if (mode === "none") return json;
  if (mode === "revealed" && activeClozeOrd == null) return json;

  const clone = structuredClone(json);

  function clozeOrdFromMark(mark: { attrs?: Record<string, unknown> }): number {
    const id = String(mark.attrs?.id ?? "c1");
    const n = Number.parseInt(id.replace(/^c/i, ""), 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function blankPlaceholder(mark: { attrs?: Record<string, unknown> }): string {
    const hint = mark.attrs?.hint;
    return clozeHintPlaceholder(hint == null ? null : String(hint));
  }

  function stripClozeMark(node: JSONContent, clozeIndex: number) {
    if (!node.marks) return;
    node.marks = node.marks.filter((_, index) => index !== clozeIndex);
    if (node.marks.length === 0) delete node.marks;
  }

  function walk(node: JSONContent) {
    if (node.type === "text" && node.marks) {
      const clozeIndex = node.marks.findIndex((mark) => mark.type === "cloze");
      if (clozeIndex >= 0) {
        const cloze = node.marks[clozeIndex];
        const ord = clozeOrdFromMark(cloze);

        if (activeClozeOrd != null) {
          if (mode === "hidden") {
            if (ord === activeClozeOrd) {
              node.text = blankPlaceholder(cloze);
            } else {
              stripClozeMark(node, clozeIndex);
            }
          } else if (ord !== activeClozeOrd) {
            // Answer side: non-active clozes read as normal body text.
            stripClozeMark(node, clozeIndex);
          }
        } else if (mode === "hidden") {
          node.text = blankPlaceholder(cloze);
        }
      }
    }
    node.content?.forEach(walk);
  }
  walk(clone);
  return clone;
}

export function richTextToHtmlWithClozeMode(
  json: JSONContent,
  mode: "hidden" | "revealed" | "none",
  activeClozeOrd?: number,
): string {
  return richTextToHtml(applyClozeModeToJson(json, mode, activeClozeOrd));
}
