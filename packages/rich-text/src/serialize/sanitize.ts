/**
 * Server/browser-safe HTML sanitizer (no jsdom).
 * Used before any read-only card HTML is inserted into the DOM.
 */
const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h2",
  "h3",
  "a",
  "span",
  "div",
  "math",
  "semantics",
  "mrow",
  "mi",
  "mo",
  "mn",
  "msup",
  "msub",
  "mfrac",
  "mroot",
  "msqrt",
  "mtable",
  "mtr",
  "mtd",
  "annotation",
]);

const GLOBAL_ALLOWED_ATTRS = new Set(["class", "aria-hidden"]);
const TAG_ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  span: new Set(["data-cloze-id", "data-cloze-hint", "data-type", "data-latex-formula", "style"]),
  div: new Set(["data-type", "data-latex-formula", "style"]),
  annotation: new Set(["encoding"]),
};

const UNSAFE_TAG = /<\/?([a-zA-Z0-9:-]+)([^>]*)>/g;
const EVENT_HANDLER = /\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
const JS_HREF = /href\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi;

function isAllowedAttr(tag: string, attrName: string): boolean {
  const name = attrName.toLowerCase();
  if (GLOBAL_ALLOWED_ATTRS.has(name)) return true;
  return TAG_ALLOWED_ATTRS[tag]?.has(name) ?? false;
}

function sanitizeTag(tagName: string, attrs: string, closing: boolean): string {
  if (!ALLOWED_TAGS.has(tagName)) return "";

  if (closing) return `</${tagName}>`;

  const allowedAttrs: string[] = [];
  const attrPattern = /([a-zA-Z0-9:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(attrs)) !== null) {
    const attrName = match[1];
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    if (!isAllowedAttr(tagName, attrName)) continue;
    if (attrName.toLowerCase() === "href" && value.trim().toLowerCase().startsWith("javascript:")) {
      continue;
    }
    allowedAttrs.push(`${attrName}="${value.replace(/"/g, "&quot;")}"`);
  }

  return allowedAttrs.length > 0
    ? `<${tagName} ${allowedAttrs.join(" ")}>`
    : `<${tagName}>`;
}

export function sanitizeCardHtml(html: string): string {
  let out = html.replace(EVENT_HANDLER, "").replace(JS_HREF, "");
  out = out.replace(UNSAFE_TAG, (full, tag, attrs) => {
    const tagName = String(tag).toLowerCase();
    if (tagName === "br") return "<br>";
    const closing = full.startsWith("</");
    return sanitizeTag(tagName, attrs ?? "", closing);
  });
  return out;
}
