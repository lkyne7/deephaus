import { marked } from "marked";
import type { JSONContent } from "@tiptap/core";
import type { CardRichTextContent } from "../types.js";
import { clozeClassName } from "../extensions/cloze-colors.js";
import { htmlToRichTextJson, richTextToHtml, richTextToPlainText } from "./html.js";
import { richTextToMarkdown } from "./markdown.js";

marked.setOptions({ gfm: true, breaks: true });

type Token = { type: "cloze" | "latexBlock" | "latexInline"; value: string };

function replaceWithTokens(input: string, regex: RegExp, type: Token["type"], tokens: Token[]): string {
  return input.replace(regex, (match) => {
    const id = tokens.length;
    tokens.push({ type, value: match });
    return `DHPROTECTEDTOKEN${id}END`;
  });
}

function tokenizeProtected(markdown: string): { tokens: Token[]; stripped: string } {
  const tokens: Token[] = [];
  let stripped = markdown;
  stripped = replaceWithTokens(
    stripped,
    /\{\{c(\d+)::([\s\S]+?)(?:::([\s\S]+?))?\}\}/g,
    "cloze",
    tokens,
  );
  stripped = replaceWithTokens(stripped, /\$\$([\s\S]+?)\$\$/g, "latexBlock", tokens);
  stripped = replaceWithTokens(
    stripped,
    /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g,
    "latexInline",
    tokens,
  );
  return { tokens, stripped };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function clozeToHtml(raw: string): string {
  const match = /^\{\{c(\d+)::([\s\S]+?)(?:::([\s\S]+?))?\}\}$/.exec(raw);
  if (!match) return raw;
  const id = `c${match[1]}`;
  const hint = match[3] ? ` data-cloze-hint="${escapeAttr(match[3])}"` : "";
  return `<span data-cloze-id="${id}" class="${clozeClassName(id)}"${hint}>${escapeHtml(match[2])}</span>`;
}

function latexInlineToHtml(raw: string): string {
  const formula = raw.replace(/^\$|\$$/g, "");
  return `<span data-type="latex-inline" data-latex-formula="${escapeAttr(formula)}"></span>`;
}

function latexBlockToHtml(raw: string): string {
  const formula = raw.replace(/^\$\$|\$\$$/g, "").trim();
  return `<div data-type="latex-block" data-latex-formula="${escapeAttr(formula)}"></div>`;
}

function restoreTokens(html: string, tokens: Token[]): string {
  let out = html;
  tokens.forEach((token, index) => {
    const placeholder = `DHPROTECTEDTOKEN${index}END`;
    let replacement = token.value;
    if (token.type === "cloze") replacement = clozeToHtml(token.value);
    if (token.type === "latexInline") replacement = latexInlineToHtml(token.value);
    if (token.type === "latexBlock") replacement = latexBlockToHtml(token.value);
    out = out.split(placeholder).join(replacement);
  });
  return out;
}

export function markdownToRichTextJson(markdown: string): JSONContent {
  const { tokens, stripped } = tokenizeProtected(markdown.trim());
  const html = marked.parse(stripped, { async: false }) as string;
  return htmlToRichTextJson(restoreTokens(html, tokens));
}

export function markdownToRichText(markdown: string): CardRichTextContent {
  const json = markdownToRichTextJson(markdown);
  return buildCardRichTextContent(json);
}

export function buildCardRichTextContent(json: JSONContent): CardRichTextContent {
  return {
    json,
    html: richTextToHtml(json),
    markdown: richTextToMarkdown(json),
    plainText: richTextToPlainText(json),
  };
}

export function normalizeEditorValue(
  value: string | CardRichTextContent | null | undefined,
): CardRichTextContent {
  if (!value) {
    const json = { type: "doc", content: [{ type: "paragraph" }] } satisfies JSONContent;
    return buildCardRichTextContent(json);
  }
  if (typeof value === "string") {
    if (!value.trim()) return buildCardRichTextContent({ type: "doc", content: [{ type: "paragraph" }] });
    return markdownToRichText(value);
  }
  return value;
}
