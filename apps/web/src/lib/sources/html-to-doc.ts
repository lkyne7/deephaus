import "server-only";
import type { JSONContent } from "@tiptap/core";
import { type HTMLElement as ParsedElement, type Node as ParsedNode, parse } from "node-html-parser";

/**
 * Convert simple HTML (mammoth DOCX output) into a ProseMirror document for the
 * source-document editor. Runs server-side (TipTap's generateJSON needs a DOM,
 * so we parse with node-html-parser and map the handful of tags mammoth emits:
 * headings, paragraphs, lists, blockquotes, images, and inline bold/italic/link).
 */
export function htmlToSourceDoc(html: string): JSONContent {
  const root = parse(html, { blockTextElements: { script: false, style: false } });
  const content: JSONContent[] = [];
  for (const node of root.childNodes) {
    collectBlock(node, content);
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function isElement(node: ParsedNode): node is ParsedElement {
  return node.nodeType === ELEMENT_NODE;
}

function tagName(node: ParsedElement): string {
  return node.rawTagName?.toLowerCase() ?? "";
}

function headingLevel(tag: string): number | null {
  const match = tag.match(/^h([1-6])$/);
  if (!match) return null;
  return Math.min(3, Number(match[1]));
}

/** Append the block-level node(s) for an element into `out`. */
function collectBlock(node: ParsedNode, out: JSONContent[]): void {
  if (node.nodeType === TEXT_NODE) {
    const text = decodeEntities(node.rawText).trim();
    if (text) out.push({ type: "paragraph", content: [{ type: "text", text }] });
    return;
  }
  if (!isElement(node)) return;

  const tag = tagName(node);
  const level = headingLevel(tag);
  if (level) {
    const inline = collectInline(node, []);
    if (inline.length) out.push({ type: "heading", attrs: { level }, content: inline });
    return;
  }

  switch (tag) {
    case "p": {
      const imgs = directImages(node);
      const inline = collectInline(node, []);
      if (inline.length) out.push({ type: "paragraph", content: inline });
      // Images inside a paragraph become their own blocks (schema is block-level).
      for (const img of imgs) out.push(img);
      if (!inline.length && imgs.length === 0) out.push({ type: "paragraph" });
      return;
    }
    case "ul":
    case "ol": {
      const list = buildList(node, tag === "ol" ? "orderedList" : "bulletList");
      if (list) out.push(list);
      return;
    }
    case "blockquote": {
      const inner: JSONContent[] = [];
      for (const child of node.childNodes) collectBlock(child, inner);
      out.push({ type: "blockquote", content: inner.length ? inner : [{ type: "paragraph" }] });
      return;
    }
    case "img": {
      const img = imageNode(node);
      if (img) out.push(img);
      return;
    }
    case "br":
      return;
    case "table":
    case "div":
    case "section":
    case "article": {
      for (const child of node.childNodes) collectBlock(child, out);
      return;
    }
    default: {
      const inline = collectInline(node, []);
      if (inline.length) out.push({ type: "paragraph", content: inline });
    }
  }
}

function buildList(node: ParsedElement, type: "bulletList" | "orderedList"): JSONContent | null {
  const items: JSONContent[] = [];
  for (const child of node.childNodes) {
    if (!isElement(child) || tagName(child) !== "li") continue;
    const itemContent: JSONContent[] = [];
    const inline = collectInline(child, [], { skipNestedLists: true });
    if (inline.length) itemContent.push({ type: "paragraph", content: inline });
    for (const grand of child.childNodes) {
      if (isElement(grand) && (tagName(grand) === "ul" || tagName(grand) === "ol")) {
        const nested = buildList(grand, tagName(grand) === "ol" ? "orderedList" : "bulletList");
        if (nested) itemContent.push(nested);
      }
    }
    if (itemContent.length === 0) itemContent.push({ type: "paragraph" });
    items.push({ type: "listItem", content: itemContent });
  }
  return items.length ? { type, content: items } : null;
}

type InlineOptions = { skipNestedLists?: boolean };

/** Flatten inline content of an element into ProseMirror text nodes with marks. */
function collectInline(
  node: ParsedNode,
  marks: JSONContent["marks"],
  options: InlineOptions = {},
): JSONContent[] {
  if (node.nodeType === TEXT_NODE) {
    const text = decodeEntities(node.rawText);
    if (!text) return [];
    return [{ type: "text", text, ...(marks && marks.length ? { marks } : {}) }];
  }
  if (!isElement(node)) return [];

  const tag = tagName(node);
  if (tag === "img") {
    return []; // handled as block-level
  }
  if (options.skipNestedLists && (tag === "ul" || tag === "ol")) {
    return [];
  }
  if (tag === "br") {
    return [{ type: "hardBreak" }];
  }

  const nextMarks = withMark(marks, node);
  const out: JSONContent[] = [];
  for (const child of node.childNodes) {
    out.push(...collectInline(child, nextMarks, options));
  }
  return out;
}

function withMark(marks: JSONContent["marks"], node: ParsedElement): JSONContent["marks"] {
  const tag = tagName(node);
  const base = marks ? [...marks] : [];
  if (tag === "strong" || tag === "b") base.push({ type: "bold" });
  else if (tag === "em" || tag === "i") base.push({ type: "italic" });
  else if (tag === "u") base.push({ type: "underline" });
  else if (tag === "s" || tag === "strike" || tag === "del") base.push({ type: "strike" });
  else if (tag === "code") base.push({ type: "code" });
  else if (tag === "a") {
    const href = node.getAttribute("href");
    if (href) base.push({ type: "link", attrs: { href } });
  }
  return base;
}

function directImages(node: ParsedElement): JSONContent[] {
  const imgs: JSONContent[] = [];
  for (const child of node.querySelectorAll("img")) {
    const img = imageNode(child);
    if (img) imgs.push(img);
  }
  return imgs;
}

function imageNode(node: ParsedElement): JSONContent | null {
  const src = node.getAttribute("src");
  if (!src) return null;
  const alt = node.getAttribute("alt") ?? "";
  return { type: "image", attrs: { src, alt, title: alt || null } };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}
