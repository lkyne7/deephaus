import { renderKatex } from "../extensions/latex.js";

const INLINE_LATEX =
  /<span\b([^>]*\bdata-type="latex-inline"[^>]*\bdata-latex-formula="([^"]*)"[^>]*|[^>]*\bdata-latex-formula="([^"]*)"[^>]*\bdata-type="latex-inline"[^>]*)\s*(?:\/>|><\/span>)/gi;

const BLOCK_LATEX =
  /<div\b([^>]*\bdata-type="latex-block"[^>]*\bdata-latex-formula="([^"]*)"[^>]*|[^>]*\bdata-latex-formula="([^"]*)"[^>]*\bdata-type="latex-block"[^>]*)\s*(?:\/>|><\/div>)/gi;

function decodeHtmlAttribute(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|amp|quot|apos|lt|gt);/gi,
    (entity, decimal, hexadecimal) => {
      if (decimal) {
        const codePoint = Number.parseInt(decimal, 10);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      if (hexadecimal) {
        const codePoint = Number.parseInt(hexadecimal, 16);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&quot;":
          return '"';
        case "&apos;":
          return "'";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        default:
          return entity;
      }
    },
  );
}

function injectWithDomParser(html: string): string | null {
  if (typeof DOMParser === "undefined") return null;

  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) return null;

  root.querySelectorAll('[data-type="latex-inline"]').forEach((element) => {
    const formula = element.getAttribute("data-latex-formula") ?? "";
    element.innerHTML = renderKatex(formula, false);
  });

  root.querySelectorAll('[data-type="latex-block"]').forEach((element) => {
    const formula = element.getAttribute("data-latex-formula") ?? "";
    element.innerHTML = renderKatex(formula, true);
  });

  return root.innerHTML;
}

function injectWithRegex(html: string): string {
  let out = html.replace(INLINE_LATEX, (_match, attrs, formulaA, formulaB) => {
    const formula = decodeHtmlAttribute(formulaA ?? formulaB ?? "");
    return `<span ${attrs}>${renderKatex(formula, false)}</span>`;
  });

  out = out.replace(BLOCK_LATEX, (_match, attrs, formulaA, formulaB) => {
    const formula = decodeHtmlAttribute(formulaA ?? formulaB ?? "");
    return `<div ${attrs}>${renderKatex(formula, true)}</div>`;
  });

  return out;
}

export function injectKatexIntoHtml(html: string): string {
  return injectWithDomParser(html) ?? injectWithRegex(html);
}
