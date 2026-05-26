"use client";

import {
  buildCardRichTextContent,
  getCardEditorExtensions,
  markdownToRichTextJson,
  normalizeEditorValue,
  type CardRichTextContent,
} from "@deephaus/rich-text";
import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo, useRef, useLayoutEffect } from "react";
import { FloatingEditorToolbar } from "./floating-editor-toolbar";
import { ClozeEditMenu } from "./cloze-edit-menu";
import "./rich-text.css";

export type InlineCardEditorProps = {
  value?: string | CardRichTextContent | null;
  onChange: (content: CardRichTextContent) => void;
  placeholder?: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  className?: string;
  /** When false, cloze marks, shortcuts, and toolbar controls are disabled. */
  clozeEnabled?: boolean;
  /** When this changes the editor instance is recreated (e.g. card id + field). */
  instanceKey?: string;
};

const MARKDOWN_PASTE_PATTERN = /(\*\*|__|\{\{c\d+::|\$\$|\$[^$\n]+\$|^#{1,3}\s)/m;

export function InlineCardEditor({ instanceKey = "default", ...props }: InlineCardEditorProps) {
  // Remount the inner editor on instanceKey so TipTap hooks stay stable per instance.
  return <InlineCardEditorInner key={instanceKey} instanceKey={instanceKey} {...props} />;
}

function InlineCardEditorInner({
  instanceKey = "default",
  value,
  onChange,
  placeholder = "Write card content…",
  readOnly = false,
  autoFocus = false,
  className,
  clozeEnabled = false,
}: InlineCardEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editorRef = useRef<Editor | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const formatPluginKey = `formatToolbar:${instanceKey}`;
  const clozePluginKey = `clozeEditMenu:${instanceKey}`;

  const normalized = useMemo(() => normalizeEditorValue(value), [value]);
  const initialContent = normalized.json;

  const extensions = useMemo(
    () => getCardEditorExtensions({ placeholder, clozeEnabled }),
    [placeholder, clozeEnabled],
  );

  const lastExternalMarkdown = useRef(normalized.markdown);

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable: !readOnly,
    autofocus: autoFocus ? "end" : false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: "dh-inline-card-editor__prosemirror",
      },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData("text/plain")?.trim();
        const activeEditor = editorRef.current;
        if (!text || !MARKDOWN_PASTE_PATTERN.test(text) || !activeEditor) return false;
        event.preventDefault();
        const json = markdownToRichTextJson(text);
        activeEditor.commands.insertContent(json.content ?? []);
        return true;
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      const content = buildCardRichTextContent(activeEditor.getJSON());
      lastExternalMarkdown.current = content.markdown;

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        onChangeRef.current(content);
      }, 250);
    },
  });

  useEffect(() => {
    editorRef.current = editor ?? null;
  }, [editor]);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!editor || editor.isDestroyed || !mountedRef.current) return;
    if (normalized.markdown === lastExternalMarkdown.current) return;
    lastExternalMarkdown.current = normalized.markdown;
    editor.commands.setContent(normalized.json, false);
  }, [editor, normalized.json, normalized.markdown]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  return (
    <div
      className={`dh-inline-card-editor${readOnly ? " dh-inline-card-editor--readonly" : ""}${className ? ` ${className}` : ""}`}
      onBlur={() => {
        if (!editor || editor.isDestroyed || !mountedRef.current) return;
        const content = buildCardRichTextContent(editor.getJSON());
        lastExternalMarkdown.current = content.markdown;
        onChangeRef.current(content);
      }}
    >
      {editor ? (
        <div className="dh-inline-card-editor__menus">
          <FloatingEditorToolbar
            editor={editor}
            disabled={readOnly}
            clozeEnabled={clozeEnabled}
            menuPluginKey={formatPluginKey}
          />
          {clozeEnabled ? (
            <ClozeEditMenu editor={editor} disabled={readOnly} menuPluginKey={clozePluginKey} />
          ) : null}
        </div>
      ) : null}
      <div className="dh-inline-card-editor__content">
        {editor ? <EditorContent editor={editor} /> : null}
      </div>
    </div>
  );
}
