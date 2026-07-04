import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/core";
import { LatexBlock, LatexInline } from "./latex.js";

export type SourceDocumentExtensionOptions = {
  placeholder?: string;
};

/**
 * Extension set for the editable, Notion-style source document on the Create
 * page. Unlike the card editor, this is a full document: headings (1–3), lists,
 * blockquotes, images, and LaTeX. No cloze marks — source material isn't a card.
 */
export function getSourceDocumentExtensions(
  options: SourceDocumentExtensionOptions = {},
): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      history: { depth: 200, newGroupDelay: 500 },
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
    }),
    Image.configure({
      inline: false,
      allowBase64: false,
    }),
    Placeholder.configure({
      placeholder: options.placeholder ?? "Your extracted notes appear here…",
    }),
    LatexInline,
    LatexBlock,
  ];
}
