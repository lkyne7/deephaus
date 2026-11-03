"use dom";

import {
  getCardEditorExtensions,
  markdownToRichTextJson,
  richTextToMarkdown,
} from "@deephaus/rich-text";
import { Editor, type Extensions } from "@tiptap/core";
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from "expo/dom";
import { forwardRef, useEffect, useRef, type Ref } from "react";
import "katex/dist/katex.min.css";
import "./rich-field.css";
import type {
  RichFieldHandle,
  RichFieldLatexTap,
  RichFieldState,
  RichFieldTheme,
} from "./rich-field-types";

type Props = {
  label: string;
  /** Markdown. Applied on mount and whenever it is not an echo of `onChange`. */
  value: string;
  placeholder: string;
  clozeEnabled: boolean;
  disabled: boolean;
  theme: RichFieldTheme;
  onChange: (markdown: string) => void | Promise<void>;
  onState: (state: RichFieldState) => void | Promise<void>;
  onLatexTap: (detail: RichFieldLatexTap) => void | Promise<void>;
  dom?: DOMProps;
};

/** Markdown strings this editor emitted recently; the native side echoes them back as `value`. */
const ECHO_HISTORY = 50;

function snapshot(editor: Editor): RichFieldState {
  let caret: RichFieldState["caret"] = null;
  try {
    const coords = editor.view.coordsAtPos(editor.state.selection.head);
    caret = { top: coords.top + window.scrollY, bottom: coords.bottom + window.scrollY };
  } catch {
    caret = null;
  }
  const clozeAttrs = editor.isActive("cloze") ? editor.getAttributes("cloze") : null;
  return {
    focused: editor.isFocused,
    empty: editor.isEmpty,
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    bulletList: editor.isActive("bulletList"),
    orderedList: editor.isActive("orderedList"),
    cloze: clozeAttrs
      ? {
          id: String(clozeAttrs.id ?? "c1"),
          hint: clozeAttrs.hint ? String(clozeAttrs.hint) : null,
        }
      : null,
    canUndo: (editor.can() as unknown as Record<string, () => boolean>).undo(),
    canRedo: (editor.can() as unknown as Record<string, () => boolean>).redo(),
    caret,
  };
}

/**
 * StarterKit's command typings are declared by packages the app doesn't import
 * directly; the chain is typed loosely for those (the custom card commands are
 * typed by @deephaus/rich-text).
 */
type LooseChain = { run(): boolean } & Record<string, (...args: unknown[]) => LooseChain>;

function chain(editor: Editor): LooseChain {
  return editor.chain().focus() as unknown as LooseChain;
}

const WORD_CHAR = /[\p{L}\p{N}_'’-]/u;

/** Select the word around a collapsed cursor so a cloze can wrap it. */
function selectWordAtCursor(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  const parent = $from.parent;
  if (!parent.isTextblock) return false;
  // Inline atoms (formulas) occupy one position but no text; stand in a placeholder of length 1.
  const text = parent.textBetween(0, parent.content.size, undefined, "\u0000");
  const offset = $from.parentOffset;
  let start = offset;
  let end = offset;
  while (start > 0 && WORD_CHAR.test(text[start - 1] ?? "")) start -= 1;
  while (end < text.length && WORD_CHAR.test(text[end] ?? "")) end += 1;
  if (start === end) return false;
  const base = $from.start();
  return editor.commands.setTextSelection({ from: base + start, to: base + end });
}

function applyTheme(theme: RichFieldTheme) {
  const root = document.documentElement;
  root.style.colorScheme = theme.scheme;
  root.style.setProperty("--dh-font-scale", String(theme.fontScale));
  root.style.setProperty("--dh-text", theme.text);
  root.style.setProperty("--dh-placeholder", theme.placeholder);
  root.style.setProperty("--dh-muted", theme.muted);
  root.style.setProperty("--dh-link", theme.link);
  root.style.setProperty("--dh-border", theme.border);
  root.style.setProperty("--dh-code-bg", theme.codeBg);
  root.style.setProperty("--dh-surface", theme.surface);
  root.style.setProperty("--dh-selection", theme.selection);
  theme.cloze.forEach((palette, index) => {
    const n = index + 1;
    root.style.setProperty(`--cloze-c${n}-bg`, palette.bg);
    root.style.setProperty(`--cloze-c${n}-fg`, palette.fg);
    root.style.setProperty(`--cloze-c${n}-border`, palette.border);
  });
}

function buildExtensions(placeholder: string, clozeEnabled: boolean): Extensions {
  return getCardEditorExtensions({ placeholder, clozeEnabled }).map((extension) =>
    // Crop/download buttons dispatch web-only events; the native editor has no handlers for them.
    extension.name === "image"
      ? (extension as unknown as { configure: (o: object) => typeof extension }).configure({
          imageActions: [],
        })
      : extension,
  );
}

const RichField = forwardRef<RichFieldHandle, Props>(function RichField(props, ref) {
  const { value, placeholder, clozeEnabled, disabled, theme } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const emittedRef = useRef<string[]>([]);
  const appliedRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);

  function scheduleState() {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const editor = editorRef.current;
      if (!editor || editor.isDestroyed) return;
      void propsRef.current.onState(snapshot(editor));
    });
  }

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const editor = new Editor({
      element: host,
      extensions: buildExtensions(placeholder, clozeEnabled),
      content: markdownToRichTextJson(propsRef.current.value),
      editable: !propsRef.current.disabled,
      editorProps: {
        attributes: {
          class: "dh-field__content",
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": propsRef.current.label,
          autocapitalize: "sentences",
          autocorrect: "on",
          spellcheck: "true",
        },
      },
      onUpdate: ({ editor: current }) => {
        const markdown = richTextToMarkdown(current.getJSON());
        const last = emittedRef.current[emittedRef.current.length - 1] ?? appliedRef.current;
        if (markdown !== last) {
          emittedRef.current.push(markdown);
          if (emittedRef.current.length > ECHO_HISTORY) emittedRef.current.shift();
          void propsRef.current.onChange(markdown);
        }
        scheduleState();
      },
      onSelectionUpdate: scheduleState,
      onFocus: scheduleState,
      onBlur: scheduleState,
    });
    appliedRef.current = propsRef.current.value;
    editorRef.current = editor;

    // Tapping a formula opens the native prompt; the node itself is not editable.
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const element = target?.closest<HTMLElement>(
        '[data-type="latex-inline"], [data-type="latex-block"]',
      );
      if (!element) return;
      let found: RichFieldLatexTap | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (found) return false;
        if (node.type.name !== "latexInline" && node.type.name !== "latexBlock") return true;
        if (editor.view.nodeDOM(pos) === element) {
          found = {
            pos,
            formula: String(node.attrs.formula ?? ""),
            display: node.type.name === "latexBlock",
          };
          return false;
        }
        return true;
      });
      if (found) void propsRef.current.onLatexTap(found);
    };
    host.addEventListener("click", handleClick);
    scheduleState();

    return () => {
      host.removeEventListener("click", handleClick);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      editor.destroy();
      editorRef.current = null;
    };
    // Extensions are fixed when the editor is created.
  }, [placeholder, clozeEnabled]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    if (value === appliedRef.current || emittedRef.current.includes(value)) return;
    appliedRef.current = value;
    editor.commands.setContent(markdownToRichTextJson(value), false);
    scheduleState();
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!disabled);
  }, [disabled]);

  useDOMImperativeHandle(
    ref as Ref<DOMImperativeFactory>,
    () => {
      const run = (fn: (editor: Editor) => unknown) => {
        const editor = editorRef.current;
        if (!editor || editor.isDestroyed) return;
        fn(editor);
      };
      return ({
        focus: () => run((e) => e.commands.focus()),
        blur: () => {
          run((e) => e.commands.blur());
          (document.activeElement as HTMLElement | null)?.blur();
        },
        toggleBold: () => run((e) => chain(e).toggleBold().run()),
        toggleItalic: () => run((e) => chain(e).toggleItalic().run()),
        toggleUnderline: () => run((e) => chain(e).toggleUnderline().run()),
        toggleStrike: () => run((e) => chain(e).toggleStrike().run()),
        toggleCode: () => run((e) => chain(e).toggleCode().run()),
        toggleBulletList: () => run((e) => chain(e).toggleBulletList().run()),
        toggleOrderedList: () => run((e) => chain(e).toggleOrderedList().run()),
        addCloze: () =>
          run((e) => {
            if (e.isActive("cloze")) return;
            if (e.state.selection.empty && !selectWordAtCursor(e)) return;
            e.chain().focus().addClozeNew().run();
          }),
        setClozeId: (id) => run((e) => e.chain().updateCloze({ id: String(id) }).run()),
        setClozeHint: (hint) =>
          run((e) => e.chain().updateCloze({ hint: hint ? String(hint) : null }).run()),
        removeCloze: () => run((e) => e.chain().removeCloze().run()),
        insertLatex: (formula, display) =>
          run((e) =>
            display
              ? e.chain().insertLatexBlock(String(formula)).run()
              : e.chain().insertLatexInline(String(formula)).run(),
          ),
        setLatexFormula: (pos, formula) =>
          run((e) =>
            e
              .chain()
              .command(({ tr }) => {
                const node = tr.doc.nodeAt(Number(pos));
                if (!node || (node.type.name !== "latexInline" && node.type.name !== "latexBlock")) {
                  return false;
                }
                tr.setNodeMarkup(Number(pos), undefined, { ...node.attrs, formula: String(formula) });
                return true;
              })
              .run(),
          ),
        insertImage: (src, alt) =>
          run((e) => e.chain().focus().setImage({ src: String(src), alt: String(alt) }).run()),
        insertAudio: (src, title) =>
          run((e) => e.chain().focus().setAudioClip({ src: String(src), title: String(title) }).run()),
        undo: () => run((e) => chain(e).undo().run()),
        redo: () => run((e) => chain(e).redo().run()),
      } satisfies RichFieldHandle) as unknown as DOMImperativeFactory;
    },
    [],
  );

  return <div className="dh-field" ref={hostRef} />;
});

export default RichField;
