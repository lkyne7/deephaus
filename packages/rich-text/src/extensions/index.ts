import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Color } from "@tiptap/extension-color";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/core";
import { ClozeMark } from "./cloze.js";
import { LatexBlock, LatexInline } from "./latex.js";
import { ResizableImage } from "./resizable-image.js";

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
    Superscript,
    Subscript,
    TextStyle,
    Color,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
    }),
    ResizableImage.configure({
      inline: false,
      allowBase64: false,
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
export {
  ResizableImage,
  clampImageDisplayWidth,
  normalizeImageAspectRatio,
  MIN_IMAGE_DISPLAY_WIDTH,
  MAX_IMAGE_DISPLAY_WIDTH,
  type ResizableImageAction,
  type ResizableImageAttributes,
} from "./resizable-image.js";
