import {
  MAX_IMAGE_DISPLAY_WIDTH,
  clampImageDisplayWidth,
  normalizeImageAspectRatio,
} from "@deephaus/shared";

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
  "del",
  "sup",
  "sub",
  "code",
  "pre",
  "blockquote",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "a",
  "img",
  "span",
  "div",
  "input",
  "label",
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
  img: new Set([
    "src",
    "alt",
    "data-display-width",
    "data-aspect-ratio",
    "style",
  ]),
  span: new Set(["data-cloze-id", "data-cloze-hint", "data-type", "data-latex-formula", "style"]),
  div: new Set(["data-type", "data-latex-formula", "data-emoji", "data-open", "style"]),
  ul: new Set(["data-type"]),
  li: new Set(["data-type", "data-checked"]),
  input: new Set(["type", "checked", "disabled"]),
  th: new Set(["colspan", "rowspan", "colwidth"]),
  td: new Set(["colspan", "rowspan", "colwidth"]),
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

function responsiveImageStyle(displayWidth: number, aspectRatio: number | null): string {
  return [
    `width: ${displayWidth}%`,
    "max-width: 100%",
    "height: auto",
    aspectRatio == null ? null : `aspect-ratio: ${aspectRatio}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function sanitizeImageStyle(style: string): string | null {
  let width: number | null = null;
  let maxWidth = false;
  let autoHeight = false;
  let aspectRatio: number | null = null;

  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration.slice(colon + 1).trim().toLowerCase();
    if (property === "width" && /^\d+(?:\.\d+)?%$/.test(value)) {
      width = clampImageDisplayWidth(value);
    } else if (property === "max-width" && value === "100%") {
      maxWidth = true;
    } else if (property === "height" && value === "auto") {
      autoHeight = true;
    } else if (property === "aspect-ratio") {
      aspectRatio = normalizeImageAspectRatio(value);
    }
  }

  if (width == null && aspectRatio == null) return null;
  return [
    width == null ? null : `width: ${width}%`,
    maxWidth ? "max-width: 100%" : null,
    autoHeight ? "height: auto" : null,
    aspectRatio == null ? null : `aspect-ratio: ${aspectRatio}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function sanitizeTag(tagName: string, attrs: string, closing: boolean): string {
  if (!ALLOWED_TAGS.has(tagName)) return "";

  if (closing) return `</${tagName}>`;

  const allowedAttrs: string[] = [];
  let imageDisplayWidth: number | null = null;
  let imageAspectRatio: number | null = null;
  let imageStyle: string | null = null;
  const attrPattern = /([a-zA-Z0-9:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(attrs)) !== null) {
    const attrName = match[1];
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    if (!isAllowedAttr(tagName, attrName)) continue;
    const lowerName = attrName.toLowerCase();
    const lowerValue = value.trim().toLowerCase();
    if (lowerName === "href" && lowerValue.startsWith("javascript:")) continue;
    if (lowerName === "src" && (lowerValue.startsWith("javascript:") || lowerValue.startsWith("data:"))) {
      continue;
    }
    if (tagName === "img" && lowerName === "data-display-width") {
      imageDisplayWidth = clampImageDisplayWidth(value);
      continue;
    }
    if (tagName === "img" && lowerName === "data-aspect-ratio") {
      imageAspectRatio = normalizeImageAspectRatio(value);
      continue;
    }
    if (tagName === "img" && lowerName === "style") {
      imageStyle = sanitizeImageStyle(value);
      continue;
    }
    allowedAttrs.push(`${attrName}="${value.replace(/"/g, "&quot;")}"`);
  }

  if (tagName === "img") {
    if (imageDisplayWidth != null) {
      allowedAttrs.push(`data-display-width="${imageDisplayWidth}"`);
    }
    if (imageAspectRatio != null) {
      allowedAttrs.push(`data-aspect-ratio="${imageAspectRatio}"`);
    }
    const controlledStyle =
      imageDisplayWidth != null || imageAspectRatio != null
        ? responsiveImageStyle(
            imageDisplayWidth ?? MAX_IMAGE_DISPLAY_WIDTH,
            imageAspectRatio,
          )
        : imageStyle;
    if (controlledStyle) allowedAttrs.push(`style="${controlledStyle}"`);
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
