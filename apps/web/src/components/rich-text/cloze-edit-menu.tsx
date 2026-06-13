"use client";

import { CLOZE_IDS } from "@deephaus/rich-text";
import { BubbleMenu } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const BUBBLE_MENU_TIPPY_OPTIONS = {
  duration: 120,
  placement: "top" as const,
  offset: [0, 10] as [number, number],
  maxWidth: 280,
  appendTo: "parent" as const,
};

type Props = {
  editor: Editor | null;
  disabled?: boolean;
  menuPluginKey?: string;
};

export function ClozeEditMenu({ editor, disabled, menuPluginKey = "clozeEditMenu" }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const menuElementRef = useRef<HTMLElement | null>(null);
  const [, setTick] = useState(0);
  const [hintDraft, setHintDraft] = useState("");

  const refresh = useCallback(() => setTick((n) => n + 1), []);

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

  useEffect(() => {
    if (!editor) return;
    const onChange = () => {
      refresh();
      if (editor.isActive("cloze")) {
        const hint = editor.getAttributes("cloze").hint;
        setHintDraft(typeof hint === "string" ? hint : "");
      }
    };
    editor.on("selectionUpdate", onChange);
    editor.on("transaction", onChange);
    onChange();
    return () => {
      editor.off("selectionUpdate", onChange);
      editor.off("transaction", onChange);
    };
  }, [editor, refresh]);

  if (!editor) return null;

  const activeEditor = editor;
  const attrs = activeEditor.getAttributes("cloze");
  const activeId = String(attrs.id ?? "c1");
  const hasHint = Boolean(attrs.hint);

  function withClozeRange(run: () => boolean) {
    activeEditor.chain().focus().extendMarkRange("cloze").run();
    return run();
  }

  function setId(id: string) {
    withClozeRange(() => activeEditor.commands.updateCloze({ id }));
  }

  function commitHint(value: string) {
    const trimmed = value.trim();
    withClozeRange(() => activeEditor.commands.updateCloze({ hint: trimmed || null }));
  }

  function removeCloze() {
    activeEditor.chain().focus().extendMarkRange("cloze").unsetMark("cloze").run();
  }

  return (
    <div ref={hostRef} className="dh-bubble-menu-host">
      <BubbleMenu
        editor={activeEditor}
        pluginKey={menuPluginKey}
        tippyOptions={BUBBLE_MENU_TIPPY_OPTIONS}
        className="dh-cloze-edit-menu"
        shouldShow={({ editor: activeEditor }) => !disabled && activeEditor.isActive("cloze")}
      >
      <div className="dh-cloze-edit-menu__header">
        <span className={`dh-cloze dh-cloze--${activeId} dh-cloze-edit-menu__badge`}>
          {activeId.toUpperCase()}
        </span>
        <span className="dh-cloze-edit-menu__title">Cloze deletion</span>
        {hasHint && <span className="dh-cloze-edit-menu__hint-badge">Hint</span>}
      </div>

      <div className="dh-cloze-edit-menu__ids" role="group" aria-label="Cloze number">
        {CLOZE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`dh-cloze-edit-menu__id dh-cloze dh-cloze--${id}${activeId === id ? " is-active" : ""}`}
            aria-pressed={activeId === id}
            title={`Set ${id.toUpperCase()}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setId(id)}
          >
            {id.toUpperCase()}
          </button>
        ))}
      </div>

      <label className="dh-cloze-edit-menu__hint-row">
        <span className="dh-cloze-edit-menu__hint-label">Hint</span>
        <input
          type="text"
          className="dh-cloze-edit-menu__hint-input"
          value={hintDraft ?? ""}
          placeholder="Optional hint shown when studying"
          onMouseDown={(event) => event.stopPropagation()}
          onChange={(event) => setHintDraft(event.target.value)}
          onBlur={() => commitHint(hintDraft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitHint(hintDraft);
              activeEditor.commands.focus();
            }
          }}
        />
      </label>

      <button
        type="button"
        className="dh-cloze-edit-menu__remove"
        onMouseDown={(event) => event.preventDefault()}
        onClick={removeCloze}
      >
        <i className="ri-delete-bin-line" aria-hidden />
        Remove deletion
      </button>
      </BubbleMenu>
    </div>
  );
}
