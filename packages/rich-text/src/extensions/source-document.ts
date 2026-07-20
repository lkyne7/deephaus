import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import Table from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import { Color } from "@tiptap/extension-color";
import TextStyle from "@tiptap/extension-text-style";
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
    Superscript,
    Subscript,
    TextStyle,
    Color,
    Link.configure({
      // Opened via SourceDocumentEditor click handler (more reliable than
      // TipTap's contenteditable openOnClick plugin).
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      HTMLAttributes: {
        target: "_blank",
        rel: "noopener noreferrer nofollow",
      },
    }),
    Image.configure({
      inline: false,
      allowBase64: false,
    }),
    Table.configure({
      resizable: true,
      allowTableNodeSelection: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
    Placeholder.configure({
      placeholder: options.placeholder ?? "Your extracted notes appear here…",
    }),
    LatexInline,
    LatexBlock,
  ];
}
