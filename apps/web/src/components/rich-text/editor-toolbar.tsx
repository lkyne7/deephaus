"use client";

import type { Editor } from "@tiptap/react";

type Props = {
  editor: Editor | null;
  disabled?: boolean;
};

function chain(editor: Editor) {
  return editor.chain().focus() as ReturnType<Editor["chain"]> & {
    toggleBold: () => ReturnType<Editor["chain"]>;
    toggleItalic: () => ReturnType<Editor["chain"]>;
    toggleUnderline: () => ReturnType<Editor["chain"]>;
    toggleCode: () => ReturnType<Editor["chain"]>;
    toggleBulletList: () => ReturnType<Editor["chain"]>;
    toggleOrderedList: () => ReturnType<Editor["chain"]>;
    toggleCloze: () => ReturnType<Editor["chain"]>;
    insertLatexInline: (formula?: string) => ReturnType<Editor["chain"]>;
    insertLatexBlock: (formula?: string) => ReturnType<Editor["chain"]>;
  };
}

export function EditorToolbar({ editor, disabled }: Props) {
  if (!editor) return null;

  const buttons = [
    {
      label: "B",
      title: "Bold",
      active: editor.isActive("bold"),
      onClick: () => chain(editor).toggleBold().run(),
    },
    {
      label: "I",
      title: "Italic",
      active: editor.isActive("italic"),
      onClick: () => chain(editor).toggleItalic().run(),
    },
    {
      label: "U",
      title: "Underline",
      active: editor.isActive("underline"),
      onClick: () => chain(editor).toggleUnderline().run(),
    },
    {
      label: "</>",
      title: "Inline code",
      active: editor.isActive("code"),
      onClick: () => chain(editor).toggleCode().run(),
    },
    {
      label: "•",
      title: "Bullet list",
      active: editor.isActive("bulletList"),
      onClick: () => chain(editor).toggleBulletList().run(),
    },
    {
      label: "1.",
      title: "Numbered list",
      active: editor.isActive("orderedList"),
      onClick: () => chain(editor).toggleOrderedList().run(),
    },
    {
      label: "C",
      title: "Cloze (⌘⇧C)",
      active: editor.isActive("cloze"),
      onClick: () => chain(editor).toggleCloze().run(),
    },
    {
      label: "∑",
      title: "Inline LaTeX",
      onClick: () => {
        const { from, to } = editor.state.selection;
        const selected = editor.state.doc.textBetween(from, to, " ");
        chain(editor).insertLatexInline(selected || "x").run();
      },
    },
    {
      label: "∫",
      title: "Block LaTeX",
      onClick: () => {
        const { from, to } = editor.state.selection;
        const selected = editor.state.doc.textBetween(from, to, " ");
        chain(editor).insertLatexBlock(selected || "\\frac{a}{b}").run();
      },
    },
  ];

  return (
    <div className="dh-inline-card-editor__toolbar" role="toolbar" aria-label="Formatting">
      {buttons.map((button) => (
        <button
          key={button.title}
          type="button"
          className={`dh-inline-card-editor__toolbar-btn${button.active ? " is-active" : ""}`}
          title={button.title}
          aria-label={button.title}
          disabled={disabled}
          onClick={button.onClick}
        >
          {button.label}
        </button>
      ))}
    </div>
  );
}
