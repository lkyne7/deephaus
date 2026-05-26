"use client";

import type { Editor } from "@tiptap/react";

/** Run an editor command while keeping the current text selection (for multi-step formatting). */
export function runPreservingSelection(editor: Editor, run: () => boolean): boolean {
  const { from, to, empty } = editor.state.selection;
  const hadRange = !empty;
  const result = run();

  if (hadRange) {
    const docSize = editor.state.doc.content.size;
    const nextFrom = Math.max(0, Math.min(from, docSize));
    const nextTo = Math.max(0, Math.min(to, docSize));
    if (nextFrom < nextTo) {
      editor.commands.setTextSelection({ from: nextFrom, to: nextTo });
    }
  }

  return result;
}

type EditorChain = ReturnType<Editor["chain"]> & Record<string, (...args: never[]) => EditorChain>;

function chain(editor: Editor): EditorChain {
  return editor.chain().focus() as EditorChain;
}

export function chainPreservingSelection(editor: Editor) {
  return {
    toggleBold() {
      return runPreservingSelection(editor, () => chain(editor).toggleBold().run());
    },
    toggleItalic() {
      return runPreservingSelection(editor, () => chain(editor).toggleItalic().run());
    },
    toggleUnderline() {
      return runPreservingSelection(editor, () => chain(editor).toggleUnderline().run());
    },
    toggleCode() {
      return runPreservingSelection(editor, () => chain(editor).toggleCode().run());
    },
    toggleBulletList() {
      return runPreservingSelection(editor, () => chain(editor).toggleBulletList().run());
    },
    toggleOrderedList() {
      return runPreservingSelection(editor, () => chain(editor).toggleOrderedList().run());
    },
    addClozeNew() {
      return runPreservingSelection(editor, () => chain(editor).addClozeNew().run());
    },
    applyCloze(id: string) {
      return runPreservingSelection(editor, () => chain(editor).applyCloze(id).run());
    },
    insertLatexInline(formula?: string) {
      const { from, to } = editor.state.selection;
      const selected = editor.state.doc.textBetween(from, to, " ");
      const value = formula ?? (selected || undefined);
      return chain(editor).insertLatexInline(value).run();
    },
    insertLatexBlock(formula?: string) {
      const { from, to } = editor.state.selection;
      const selected = editor.state.doc.textBetween(from, to, " ");
      const value = formula ?? (selected || undefined);
      return chain(editor).insertLatexBlock(value).run();
    },
  };
}
