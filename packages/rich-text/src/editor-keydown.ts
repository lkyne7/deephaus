import type { Editor } from "@tiptap/core";
import { RICH_TEXT_REQUEST_LINK_EVENT } from "./link.js";
import { applyLastTextColor } from "./text-color.js";

export type RichTextKeydownOptions = {
  headings?: boolean;
  headingLevels?: readonly (1 | 2 | 3)[];
  blockquote?: boolean;
  strike?: boolean;
  link?: boolean;
  cloze?: boolean;
};

const DEFAULT_HEADING_LEVELS: readonly (1 | 2 | 3)[] = [1, 2, 3];

/**
 * Explicit Mod-key handling so formatting shortcuts work reliably inside nested
 * panels and dialogs (where browser defaults or parent listeners can win).
 */
export function handleRichTextKeydown(
  editor: Editor,
  event: KeyboardEvent,
  options: RichTextKeydownOptions = {},
): boolean {
  if (!editor.isEditable) return false;

  const mod = event.metaKey || event.ctrlKey;
  if (!mod) return false;

  const key = event.key.toLowerCase();
  const shift = event.shiftKey;
  const alt = event.altKey;
  const chain = () => editor.chain().focus();

  let handled = false;

  if (!shift && !alt) {
    if (key === "b") handled = chain().toggleBold().run();
    else if (key === "i") handled = chain().toggleItalic().run();
    else if (key === "u") handled = chain().toggleUnderline().run();
    else if (key === "e") handled = chain().toggleCode().run();
    else if (key === "z") handled = chain().undo().run();
    else if (key === "y") handled = chain().redo().run();
    else if (options.link && key === "k") {
      // Selection → hyperlink UI. Collapsed caret → let global search handle Mod+K.
      const { from, to } = editor.state.selection;
      if (from !== to) {
        editor.view.dom.dispatchEvent(
          new CustomEvent(RICH_TEXT_REQUEST_LINK_EVENT, {
            bubbles: true,
            detail: { from, to },
          }),
        );
        handled = true;
      }
    }
  } else if (shift && !alt) {
    if (key === "z") handled = chain().redo().run();
    else if (key === "8") handled = chain().toggleBulletList().run();
    else if (key === "7") handled = chain().toggleOrderedList().run();
    else if (options.strike !== false && key === "s") handled = chain().toggleStrike().run();
    else if (key === "e") {
      // Equation (inline LaTeX), like Notion's ⌘⇧E.
      const { from, to } = editor.state.selection;
      const selected = editor.state.doc.textBetween(from, to, " ").trim();
      handled = chain().insertLatexInline(selected || "x").run();
    } else if (key === "h") {
      handled = applyLastTextColor(editor);
    } else if (options.blockquote !== false && key === "b") {
      handled = chain().toggleBlockquote().run();
    } else if (options.cloze && key === "c") {
      handled = chain().addClozeNew().run();
    }
  } else if (alt && !shift && options.headings !== false) {
    const level = Number(key);
    const levels = options.headingLevels ?? DEFAULT_HEADING_LEVELS;
    if (levels.includes(level as 1 | 2 | 3)) {
      handled = chain().toggleHeading({ level: level as 1 | 2 | 3 }).run();
    }
  }

  if (handled) {
    event.preventDefault();
    // Stop the app-level Mod+K global search listener from also firing.
    event.stopPropagation();
  }
  return handled;
}

export function richTextEditorKeydownProps(
  getEditor: () => Editor | null | undefined,
  options?: RichTextKeydownOptions,
) {
  return {
    handleKeyDown: (_view: unknown, event: KeyboardEvent) => {
      const editor = getEditor();
      if (!editor || editor.isDestroyed) return false;
      return handleRichTextKeydown(editor, event, options);
    },
  };
}
