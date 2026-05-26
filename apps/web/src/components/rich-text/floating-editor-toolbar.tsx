"use client";

import { BubbleMenu } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { chainPreservingSelection } from "./editor-selection";

const BUBBLE_MENU_TIPPY_OPTIONS = {
  duration: 120,
  placement: "top" as const,
  offset: [0, 8] as [number, number],
  appendTo: "parent" as const,
};

type Props = {
  editor: Editor | null;
  disabled?: boolean;
  clozeEnabled?: boolean;
  menuPluginKey?: string;
};

function ToolbarButton({
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`dh-floating-toolbar__btn${active ? " is-active" : ""}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function FloatingEditorToolbar({
  editor,
  disabled,
  clozeEnabled = false,
  menuPluginKey = "formatToolbar",
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const menuElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    menuElementRef.current = hostRef.current?.firstElementChild as HTMLElement | null;
  });

  useLayoutEffect(() => {
    return () => {
      const host = hostRef.current;
      const menuEl = menuElementRef.current;
      if (host && menuEl && menuEl.parentElement !== host) {
        host.appendChild(menuEl);
      }
      if (editor && !editor.isDestroyed) {
        editor.unregisterPlugin(menuPluginKey);
      }
    };
  }, [editor, menuPluginKey]);

  if (!editor) return null;

  const actions = chainPreservingSelection(editor);

  const formatButtons = [
    { label: "B", title: "Bold (⌘B)", active: editor.isActive("bold"), run: () => actions.toggleBold() },
    { label: "I", title: "Italic (⌘I)", active: editor.isActive("italic"), run: () => actions.toggleItalic() },
    { label: "U", title: "Underline (⌘U)", active: editor.isActive("underline"), run: () => actions.toggleUnderline() },
    { label: "</>", title: "Inline code", active: editor.isActive("code"), run: () => actions.toggleCode() },
    { label: "•", title: "Bullet list", active: editor.isActive("bulletList"), run: () => actions.toggleBulletList() },
    { label: "1.", title: "Numbered list", active: editor.isActive("orderedList"), run: () => actions.toggleOrderedList() },
    ...(clozeEnabled
      ? [
          {
            label: "C",
            title: "New cloze (⌘⇧C)",
            active: editor.isActive("cloze"),
            run: () => actions.addClozeNew(),
          },
        ]
      : []),
    {
      label: "∑",
      title: "Inline LaTeX",
      run: () => actions.insertLatexInline(),
    },
    {
      label: "∫",
      title: "Block LaTeX",
      run: () => actions.insertLatexBlock(),
    },
  ];

  return (
    <div ref={hostRef} className="dh-bubble-menu-host">
      <BubbleMenu
        editor={editor}
        pluginKey={menuPluginKey}
        tippyOptions={BUBBLE_MENU_TIPPY_OPTIONS}
        className="dh-floating-toolbar"
        shouldShow={({ editor: activeEditor, state }) => {
          if (disabled) return false;
          const { from, to } = state.selection;
          if (from === to) return false;
          return (
            activeEditor.isActive("latexInline") ||
            activeEditor.isActive("latexBlock") ||
            from !== to
          );
        }}
      >
        {formatButtons.map((button) => (
          <ToolbarButton
            key={button.title}
            label={button.label}
            title={button.title}
            active={button.active}
            disabled={disabled}
            onClick={button.run}
          />
        ))}
      </BubbleMenu>
    </div>
  );
}
