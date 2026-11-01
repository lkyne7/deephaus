/**
 * TeX → SVG for native card rendering. MathJax runs in plain JS (no DOM), so
 * formulas render offline and inside native Text without a web view. Loaded
 * lazily: most screens never show a formula and the TeX parser is large.
 */

export type MathSvg = {
  /** SVG markup; glyphs use `currentColor`. */
  xml: string;
  /** Size in em; multiply by the font size for points. */
  width: number;
  height: number;
  /** How far the formula reaches below the text baseline, in em. */
  depth: number;
};

type Converter = (formula: string, display: boolean) => string;

let converter: Converter | null = null;
const cache = new Map<string, MathSvg | null>();
const CACHE_LIMIT = 300;

function getConverter(): Converter {
  if (converter) return converter;
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { mathjax } = require("mathjax-full/js/mathjax.js");
  const { TeX } = require("mathjax-full/js/input/tex.js");
  const { SVG } = require("mathjax-full/js/output/svg.js");
  const { liteAdaptor } = require("mathjax-full/js/adaptors/liteAdaptor.js");
  const { RegisterHTMLHandler } = require("mathjax-full/js/handlers/html.js");
  // Same package set KaTeX covers on web for card formulas.
  require("mathjax-full/js/input/tex/base/BaseConfiguration.js");
  require("mathjax-full/js/input/tex/ams/AmsConfiguration.js");
  require("mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js");
  require("mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js");
  require("mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js");
  require("mathjax-full/js/input/tex/color/ColorConfiguration.js");
  require("mathjax-full/js/input/tex/cancel/CancelConfiguration.js");
  /* eslint-enable @typescript-eslint/no-require-imports */

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const document = mathjax.document("", {
    InputJax: new TeX({
      packages: ["base", "ams", "newcommand", "noundefined", "boldsymbol", "color", "cancel"],
    }),
    // Inline paths: react-native-svg does not need <defs>/<use> indirection.
    OutputJax: new SVG({ fontCache: "none" }),
  });
  converter = (formula, display) => adaptor.innerHTML(document.convert(formula, { display }));
  return converter;
}

const VIEW_BOX = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/;

/** Render a TeX formula, or null when it cannot be parsed into an SVG. */
export function texToSvg(formula: string, display = false): MathSvg | null {
  const key = `${display ? "D" : "I"}:${formula}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  let result: MathSvg | null = null;
  try {
    const markup = getConverter()(formula, display);
    const start = markup.indexOf("<svg");
    const end = markup.lastIndexOf("</svg>");
    const viewBox = VIEW_BOX.exec(markup);
    if (start >= 0 && end > start && viewBox) {
      const minY = Number(viewBox[2]);
      const width = Number(viewBox[3]);
      const height = Number(viewBox[4]);
      // MathJax font units are 1000 per em; the viewBox origin sits on the baseline.
      result = {
        xml: markup
          .slice(start, end + "</svg>".length)
          // Sizing comes from the props; drop the CSS-only attributes.
          .replace(/ style="[^"]*"/, "")
          .replace(/ width="[^"]*"/, "")
          .replace(/ height="[^"]*"/, ""),
        width: width / 1000,
        height: height / 1000,
        depth: Math.max(0, (minY + height) / 1000),
      };
    }
  } catch {
    result = null;
  }

  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, result);
  return result;
}

const BLOCK_MATH = /\$\$([\s\S]+?)\$\$/g;

export type MathBlockSegment = { type: "text"; value: string } | { type: "math"; formula: string };

/** Split out `$$…$$` display formulas; matches @deephaus/rich-text's markdown parser. */
export function splitMathBlocks(text: string): MathBlockSegment[] {
  const segments: MathBlockSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(BLOCK_MATH)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ type: "text", value: text.slice(lastIndex, index) });
    const formula = (match[1] ?? "").trim();
    if (formula) segments.push({ type: "math", formula });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ type: "text", value: text.slice(lastIndex) });
  return segments;
}
