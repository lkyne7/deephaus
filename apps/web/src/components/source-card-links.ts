import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmNode } from "@tiptap/pm/model";

/** A card's evidence quote to highlight inside the source document. */
export type SourceCardLink = {
  cardId: string;
  quote: string;
};

type PluginState = {
  links: SourceCardLink[];
  activeId: string | null;
  decorations: DecorationSet;
};

type LinksMeta = {
  links: SourceCardLink[];
  activeId: string | null;
};

export const sourceCardLinksKey = new PluginKey<PluginState>("sourceCardLinks");

/** Quotes shorter than this are too ambiguous to highlight safely. */
const MIN_QUOTE_LENGTH = 12;

/*
 * Fragment matching (used when the exact match fails).
 *
 * PDF extraction of multi-column layouts interleaves lines from neighbouring
 * columns, so a sentence the model quoted verbatim is present in the document
 * but with a foreign line spliced into the middle of it. We anchor on a short
 * run of words, then walk the rest of the quote, jumping over interleaved text
 * and tolerating a few paraphrased words. Each matched stretch becomes its own
 * highlight so the interleaved line itself is never marked.
 */
/** Quotes with fewer words than this can't be anchored reliably. */
const MIN_FRAGMENT_WORDS = 4;
/** Consecutive words that must match to anchor the alignment. */
const ANCHOR_WORDS = 3;
/** Upper bound on anchor candidates tried when the anchor phrase repeats. */
const MAX_ANCHOR_CANDIDATES = 8;
/**
 * How far (in doc words) we look past interleaved text for the quote to
 * resume. The more specific the resume phrase, the farther it may jump:
 *  - a distinctive 3-word phrase can bridge a page break (header, figure
 *    captions and the tail of the other column all land in between);
 *  - an ordinary phrase covers a few interleaved lines;
 *  - a short tail (the lone "view." that ends a sentence) only reaches
 *    across one interleaved line, and never on a tiny word.
 */
const LONG_RESUME_WINDOW_WORDS = 320;
const MIN_LONG_RESUME_CHARS = 14;
const RESUME_WINDOW_WORDS = 80;
const MIN_RESUME_CHARS = 6;
const SHORT_RESUME_WINDOW_WORDS = 24;
const MIN_SHORT_RESUME_CHARS = 4;
/** Quote words we may drop in a row before giving up (paraphrase tolerance). */
const MAX_SKIPPED_QUOTE_WORDS = 3;
/** Share of quote words that must be found for the alignment to count. */
const MIN_COVERAGE = 0.6;
/** Highlights covering fewer characters than this are noise (e.g. a lone "the"). */
const MIN_FRAGMENT_CHARS = 4;

/**
 * Fold typographic variants the LLM (or an edit) may normalize differently
 * than the extracted text: curly quotes, dashes, non-breaking spaces.
 */
const CHAR_FOLD: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u00A0": " ",
};

function foldChar(ch: string): string {
  return CHAR_FOLD[ch] ?? ch.toLowerCase();
}

/** Normalized text plus, for every output char, the doc position it came from. */
export type IndexedText = {
  text: string;
  positions: number[];
};

/**
 * Flatten the document to lowercased, whitespace-collapsed text while keeping
 * a char→docPosition map. Block boundaries become a single virtual space so
 * quotes spanning a paragraph break still match.
 */
function buildDocText(doc: PmNode): IndexedText {
  let text = "";
  const positions: number[] = [];
  let lastWasSpace = true;
  let lastPos = 0;

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      const str = node.text;
      for (let i = 0; i < str.length; i += 1) {
        const ch = str[i]!;
        if (/\s/.test(ch)) {
          if (!lastWasSpace) {
            text += " ";
            positions.push(pos + i);
            lastWasSpace = true;
          }
          continue;
        }
        // Folding can (rarely) expand to multiple chars; map them all back to
        // the same source position so ranges stay valid.
        for (const out of foldChar(ch)) {
          text += out;
          positions.push(pos + i);
        }
        lastWasSpace = false;
      }
      lastPos = pos + str.length;
      return true;
    }
    if (node.isBlock && !lastWasSpace) {
      text += " ";
      positions.push(lastPos);
      lastWasSpace = true;
    }
    return true;
  });

  return { text, positions };
}

/**
 * Remove PDF line-wrap hyphenation artifacts ("dramati- cally" → "dramatically")
 * so quotes match whether or not the model reproduced them. Applied identically
 * to the document text and the needle.
 */
function dehyphenate(input: IndexedText): IndexedText {
  const { text, positions } = input;
  let out = "";
  const outPositions: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    if (
      text[i] === "-" &&
      text[i + 1] === " " &&
      /[a-z]/.test(text[i - 1] ?? "") &&
      /[a-z]/.test(text[i + 2] ?? "")
    ) {
      i += 1; // skip the "- " pair
      continue;
    }
    out += text[i]!;
    outPositions.push(positions[i]!);
  }
  return { text: out, positions: outPositions };
}

/** Apply the same fold/collapse/dehyphenate pipeline to a quote string. */
export function normalizeQuote(quote: string): string {
  let text = "";
  const positions: number[] = [];
  let lastWasSpace = true;
  for (const ch of quote) {
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        text += " ";
        positions.push(-1);
        lastWasSpace = true;
      }
      continue;
    }
    for (const out of foldChar(ch)) {
      text += out;
      positions.push(-1);
    }
    lastWasSpace = false;
  }
  return dehyphenate({ text, positions }).text.trim();
}

export type QuoteRange = { from: number; to: number };

function findExactRange(haystack: IndexedText, needle: string): QuoteRange | null {
  if (needle.length < MIN_QUOTE_LENGTH) return null;
  // Full quote first; fall back to a prefix in case the tail was paraphrased.
  const attempts =
    needle.length > 80 ? [needle, needle.slice(0, 80).trim()] : [needle];
  for (const attempt of attempts) {
    if (attempt.length < MIN_QUOTE_LENGTH) continue;
    const index = haystack.text.indexOf(attempt);
    if (index === -1) continue;
    const from = haystack.positions[index]!;
    const to = haystack.positions[index + attempt.length - 1]! + 1;
    if (from < to) return { from, to };
  }
  return null;
}

/** A word in normalized text: char span plus the punctuation-stripped key. */
type Token = { start: number; end: number; key: string };

const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Split whitespace-collapsed text into words; pure-punctuation tokens are dropped. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  for (const match of text.matchAll(re)) {
    const key = match[0].replace(EDGE_PUNCTUATION, "");
    if (!key) continue;
    tokens.push({ start: match.index!, end: match.index! + match[0].length, key });
  }
  return tokens;
}

/** Everything the matcher needs about a document, computed once per pass. */
export type PreparedHaystack = {
  /** Fold/collapse only — hyphen wraps kept so column interleaving can't fuse words. */
  raw: IndexedText;
  /** Also dehyphenated; what the exact match runs against. */
  dehyphenated: IndexedText;
  tokens: Token[];
  /** First token index for each key, for anchor lookup. */
  byKey: Map<string, number[]>;
};

export function prepareHaystack(raw: IndexedText): PreparedHaystack {
  const tokens = tokenize(raw.text);
  const byKey = new Map<string, number[]>();
  tokens.forEach((token, index) => {
    const list = byKey.get(token.key);
    if (list) list.push(index);
    else byKey.set(token.key, [index]);
  });
  return { raw, dehyphenated: dehyphenate(raw), tokens, byKey };
}

/**
 * Index a plain string the way buildDocText indexes a single text node:
 * folded and whitespace-collapsed, with positions pointing at the original
 * string offsets. Used by tests to exercise the matcher without a PM doc.
 */
export function indexPlainText(source: string): IndexedText {
  let text = "";
  const positions: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        text += " ";
        positions.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    for (const out of foldChar(ch)) {
      text += out;
      positions.push(i);
    }
    lastWasSpace = false;
  }
  return { text, positions };
}

/** Matched doc token indexes plus how they group into highlights. */
type Alignment = { matched: number[]; groups: number[][] };

/** Tokens this close (index distance) are painted as one highlight. */
const GROUP_GAP = 2;

function groupMatches(matched: number[]): number[][] {
  const sorted = Array.from(new Set(matched)).sort((a, b) => a - b);
  const groups: number[][] = [];
  let current: number[] = [];
  for (const index of sorted) {
    if (current.length > 0 && index - current[current.length - 1]! > GROUP_GAP) {
      groups.push(current);
      current = [];
    }
    current.push(index);
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** Positive when `a` is the better alignment: more coverage, then fewer pieces, then tighter. */
function compareAlignments(a: Alignment, b: Alignment): number {
  if (a.matched.length !== b.matched.length) return a.matched.length - b.matched.length;
  if (a.groups.length !== b.groups.length) return b.groups.length - a.groups.length;
  const span = (x: Alignment) => {
    const first = x.groups[0]?.[0] ?? 0;
    const lastGroup = x.groups[x.groups.length - 1];
    const last = lastGroup?.[lastGroup.length - 1] ?? 0;
    return last - first;
  };
  return span(b) - span(a);
}

/** Does the quote run Q[q..q+len) appear at doc token index d? */
function runMatchesAt(doc: Token[], d: number, quote: string[], q: number, len: number): boolean {
  if (d < 0 || d + len > doc.length) return false;
  for (let i = 0; i < len; i += 1) {
    if (doc[d + i]!.key !== quote[q + i]) return false;
  }
  return true;
}

function runChars(quote: string[], q: number, len: number): number {
  let n = 0;
  for (let i = 0; i < len; i += 1) n += quote[q + i]!.length;
  return n;
}

/** How far a resume phrase of this many characters may jump; 0 = don't try. */
function resumeWindow(chars: number): number {
  if (chars >= MIN_LONG_RESUME_CHARS) return LONG_RESUME_WINDOW_WORDS;
  if (chars >= MIN_RESUME_CHARS) return RESUME_WINDOW_WORDS;
  if (chars >= MIN_SHORT_RESUME_CHARS) return SHORT_RESUME_WINDOW_WORDS;
  return 0;
}

/**
 * Walk forward from (q, d) matching quote words to doc words. On a mismatch,
 * first try to resume after interleaved text, then tolerate a dropped quote word.
 */
function extendForward(
  doc: Token[],
  quote: string[],
  qStart: number,
  dStart: number,
  matched: number[],
): void {
  let q = qStart;
  let d = dStart;
  let skipped = 0;
  while (q < quote.length) {
    const word = quote[q]!;
    if (d < doc.length && doc[d]!.key === word) {
      matched.push(d);
      q += 1;
      d += 1;
      skipped = 0;
      continue;
    }
    // Hyphen wrap in the doc ("dramati-" "cally") vs a whole word in the quote.
    if (d + 1 < doc.length && doc[d]!.key + doc[d + 1]!.key === word) {
      matched.push(d, d + 1);
      q += 1;
      d += 2;
      skipped = 0;
      continue;
    }
    // Interleaved column text: look ahead for where the quote picks back up.
    const runLen = Math.min(ANCHOR_WORDS, quote.length - q);
    const window = resumeWindow(runChars(quote, q, runLen));
    if (window > 0) {
      const limit = Math.min(doc.length - runLen, d + window);
      let resume = -1;
      for (let k = d + 1; k <= limit; k += 1) {
        if (runMatchesAt(doc, k, quote, q, runLen)) {
          resume = k;
          break;
        }
      }
      if (resume !== -1) {
        d = resume;
        continue;
      }
    }
    // Paraphrased word: drop it and keep going, but not indefinitely.
    skipped += 1;
    if (skipped > MAX_SKIPPED_QUOTE_WORDS) return;
    q += 1;
  }
}

/** Mirror of extendForward, walking toward the start of the quote. */
function extendBackward(
  doc: Token[],
  quote: string[],
  qStart: number,
  dStart: number,
  matched: number[],
): void {
  let q = qStart;
  let d = dStart;
  let skipped = 0;
  while (q >= 0) {
    const word = quote[q]!;
    if (d >= 0 && doc[d]!.key === word) {
      matched.push(d);
      q -= 1;
      d -= 1;
      skipped = 0;
      continue;
    }
    if (d >= 1 && doc[d - 1]!.key + doc[d]!.key === word) {
      matched.push(d - 1, d);
      q -= 1;
      d -= 2;
      skipped = 0;
      continue;
    }
    const runLen = Math.min(ANCHOR_WORDS, q + 1);
    const runStart = q - runLen + 1;
    const window = resumeWindow(runChars(quote, runStart, runLen));
    if (window > 0) {
      const limit = Math.max(runLen - 1, d - window);
      let resume = -1;
      for (let k = d - 1; k >= limit; k -= 1) {
        if (runMatchesAt(doc, k - runLen + 1, quote, runStart, runLen)) {
          resume = k;
          break;
        }
      }
      if (resume !== -1) {
        d = resume;
        continue;
      }
    }
    skipped += 1;
    if (skipped > MAX_SKIPPED_QUOTE_WORDS) return;
    q -= 1;
  }
}

function align(doc: Token[], quote: string[], qAnchor: number, dAnchor: number): Alignment {
  const matched: number[] = [];
  for (let i = 0; i < ANCHOR_WORDS; i += 1) matched.push(dAnchor + i);
  extendForward(doc, quote, qAnchor + ANCHOR_WORDS, dAnchor + ANCHOR_WORDS, matched);
  extendBackward(doc, quote, qAnchor - 1, dAnchor - 1, matched);
  const unique = Array.from(new Set(matched));
  return { matched: unique, groups: groupMatches(unique) };
}

/** Turn token groups into doc ranges, dropping fragments too small to mean anything. */
function rangesFromGroups(haystack: PreparedHaystack, groups: number[][]): QuoteRange[] {
  const ranges: QuoteRange[] = [];
  for (const group of groups) {
    const first = group[0]!;
    const last = group[group.length - 1]!;
    let chars = 0;
    for (let i = first; i <= last; i += 1) chars += haystack.tokens[i]!.key.length;
    if (chars < MIN_FRAGMENT_CHARS) continue;
    const from = haystack.raw.positions[haystack.tokens[first]!.start]!;
    const to = haystack.raw.positions[haystack.tokens[last]!.end - 1]! + 1;
    if (from < to) ranges.push({ from, to });
  }
  return ranges;
}

function findFragmentRanges(haystack: PreparedHaystack, needle: string): QuoteRange[] {
  const quote = tokenize(needle).map((t) => t.key);
  if (quote.length < MIN_FRAGMENT_WORDS) return [];
  const doc = haystack.tokens;

  // Anchor on the first quote phrase that occurs in the doc; if it occurs more
  // than once, keep whichever alignment recovers the most of the quote.
  let best: Alignment | null = null;
  for (let q = 0; q + ANCHOR_WORDS <= quote.length && !best; q += 1) {
    if (runChars(quote, q, ANCHOR_WORDS) < MIN_RESUME_CHARS) continue;
    const candidates = haystack.byKey.get(quote[q]!);
    if (!candidates) continue;
    let tried = 0;
    for (const d of candidates) {
      if (!runMatchesAt(doc, d, quote, q, ANCHOR_WORDS)) continue;
      const attempt = align(doc, quote, q, d);
      if (!best || compareAlignments(attempt, best) > 0) best = attempt;
      tried += 1;
      if (tried >= MAX_ANCHOR_CANDIDATES) break;
    }
  }
  if (!best) return [];

  const required = Math.max(MIN_FRAGMENT_WORDS, Math.ceil(quote.length * MIN_COVERAGE));
  if (best.matched.length < required) return [];
  return rangesFromGroups(haystack, best.groups);
}

/**
 * Locate a card's evidence quote in the document. Prefers a single exact
 * range; falls back to fragment alignment for quotes broken up by column
 * interleaving or light paraphrase. Empty when nothing trustworthy matches.
 */
export function locateQuote(haystack: PreparedHaystack, quote: string): QuoteRange[] {
  const needle = normalizeQuote(quote);
  const exact = findExactRange(haystack.dehyphenated, needle);
  if (exact) return [exact];
  return findFragmentRanges(haystack, needle);
}

export function buildCardLinkDecorations(
  doc: PmNode,
  links: SourceCardLink[],
  activeId: string | null,
): DecorationSet {
  if (links.length === 0) return DecorationSet.empty;
  const haystack = prepareHaystack(buildDocText(doc));
  const decorations: Decoration[] = [];
  for (const link of links) {
    const ranges = locateQuote(haystack, link.quote);
    if (ranges.length === 0) continue;
    const active = link.cardId === activeId;
    for (const range of ranges) {
      decorations.push(
        Decoration.inline(range.from, range.to, {
          class: `dh-source-cardlink${active ? " is-active" : ""}`,
          "data-card-id": link.cardId,
          title: "Open this card",
        }),
      );
    }
  }
  return DecorationSet.create(doc, decorations);
}

/**
 * Decorates the source document with clickable highlights for every card that
 * carries a verbatim `source_quote`. Highlights are recomputed when the link
 * list changes (via `setSourceCardLinks`) and re-mapped cheaply while typing.
 */
export const SourceCardLinks = Extension.create({
  name: "sourceCardLinks",

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: sourceCardLinksKey,
        state: {
          init: () => ({
            links: [],
            activeId: null,
            decorations: DecorationSet.empty,
          }),
          apply(tr, prev, _oldState, newState) {
            const meta = tr.getMeta(sourceCardLinksKey) as LinksMeta | undefined;
            if (meta) {
              return {
                links: meta.links,
                activeId: meta.activeId,
                decorations: buildCardLinkDecorations(
                  newState.doc,
                  meta.links,
                  meta.activeId,
                ),
              };
            }
            if (tr.docChanged) {
              const mapped = prev.decorations.map(tr.mapping, tr.doc);
              // Structural edits (e.g. dragging a block to reorder it) are a
              // delete + re-insert, which destroys the decorations inside the
              // moved range. If mapping lost any highlight, re-locate the
              // quotes in the new document instead of accepting the loss.
              if (
                prev.links.length > 0 &&
                mapped.find().length < prev.decorations.find().length
              ) {
                return {
                  ...prev,
                  decorations: buildCardLinkDecorations(
                    newState.doc,
                    prev.links,
                    prev.activeId,
                  ),
                };
              }
              return { ...prev, decorations: mapped };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return sourceCardLinksKey.getState(state)?.decorations ?? null;
          },
        },
      }),
    ];
  },
});

/** Push a new highlight list (and active card) into the editor's plugin state. */
export function setSourceCardLinks(
  editor: Editor,
  links: SourceCardLink[],
  activeId: string | null,
): void {
  const meta: LinksMeta = { links, activeId };
  editor.view.dispatch(editor.state.tr.setMeta(sourceCardLinksKey, meta));
}
