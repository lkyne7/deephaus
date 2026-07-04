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
type IndexedText = {
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

function findQuoteRange(
  haystack: IndexedText,
  needle: string,
): { from: number; to: number } | null {
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

export function buildCardLinkDecorations(
  doc: PmNode,
  links: SourceCardLink[],
  activeId: string | null,
): DecorationSet {
  if (links.length === 0) return DecorationSet.empty;
  const haystack = dehyphenate(buildDocText(doc));
  const decorations: Decoration[] = [];
  for (const link of links) {
    const range = findQuoteRange(haystack, normalizeQuote(link.quote));
    if (!range) continue;
    const active = link.cardId === activeId;
    decorations.push(
      Decoration.inline(range.from, range.to, {
        class: `dh-source-cardlink${active ? " is-active" : ""}`,
        "data-card-id": link.cardId,
        title: "Open this card",
      }),
    );
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
