import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/core";
import { ClozeMark } from "./cloze.js";
import { LatexBlock, LatexInline } from "./latex.js";

export type CardEditorExtensionOptions = {
  placeholder?: string;
  clozeEnabled?: boolean;
};

export function getCardEditorExtensions(options: CardEditorExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      history: {
        depth: 100,
        newGroupDelay: 500,
      },
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
    }),
    Placeholder.configure({
      placeholder: options.placeholder ?? "Write card content…",
    }),
    ClozeMark.configure({
      enabled: options.clozeEnabled ?? true,
    }),
    LatexInline,
    LatexBlock,
  ];
}

export { ClozeMark } from "./cloze.js";
export { LatexBlock, LatexInline } from "./latex.js";
