import { renderKatex } from "../extensions/latex.js";

const INLINE_LATEX =
  /<span\b([^>]*\bdata-type="latex-inline"[^>]*\bdata-latex-formula="([^"]*)"[^>]*|[^>]*\bdata-latex-formula="([^"]*)"[^>]*\bdata-type="latex-inline"[^>]*)\s*(?:\/>|><\/span>)/gi;

const BLOCK_LATEX =
  /<div\b([^>]*\bdata-type="latex-block"[^>]*\bdata-latex-formula="([^"]*)"[^>]*|[^>]*\bdata-latex-formula="([^"]*)"[^>]*\bdata-type="latex-block"[^>]*)\s*(?:\/>|><\/div>)/gi;

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
    const formula = formulaA ?? formulaB ?? "";
    return `<span ${attrs}>${renderKatex(formula, false)}</span>`;
  });

  out = out.replace(BLOCK_LATEX, (_match, attrs, formulaA, formulaB) => {
    const formula = formulaA ?? formulaB ?? "";
    return `<div ${attrs}>${renderKatex(formula, true)}</div>`;
  });

  return out;
}

export function injectKatexIntoHtml(html: string): string {
  return injectWithDomParser(html) ?? injectWithRegex(html);
}
