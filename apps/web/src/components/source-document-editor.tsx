"use client";

import { getSourceDocumentExtensions, richTextEditorKeydownProps } from "@deephaus/rich-text";
import type { Extensions, JSONContent } from "@tiptap/core";
import { BubbleMenu, EditorContent, useEditor, type Editor } from "@tiptap/react";
import GlobalDragHandle from "tiptap-extension-global-drag-handle";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SourceCardLinks,
  setSourceCardLinks,
  type SourceCardLink,
} from "@/components/source-card-links";
import "@/components/rich-text/rich-text.css";
import "./source-document-editor.css";

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * The source-doc extensions live in @deephaus/rich-text, so their command type
 * augmentations aren't visible to this app's compilation. Declare just the chain
 * methods this toolbar uses so calls type-check without `any`.
 */
type DocChain = {
  focus: () => DocChain;
  run: () => boolean;
  undo: () => DocChain;
  redo: () => DocChain;
  toggleBold: () => DocChain;
  toggleItalic: () => DocChain;
  toggleUnderline: () => DocChain;
  toggleBulletList: () => DocChain;
  toggleOrderedList: () => DocChain;
  toggleBlockquote: () => DocChain;
  toggleHeading: (attrs: { level: number }) => DocChain;
  setImage: (attrs: { src: string; alt?: string }) => DocChain;
  extendMarkRange: (name: string) => DocChain;
  setLink: (attrs: { href: string }) => DocChain;
  unsetLink: () => DocChain;
};
function chain(editor: Editor): DocChain {
  return editor.chain().focus() as unknown as DocChain;
}

const BUBBLE_TIPPY_OPTIONS = {
  duration: 120,
  placement: "top" as const,
  offset: [0, 8] as [number, number],
  appendTo: () => document.body,
};

/** A snippet to scroll to + briefly highlight; bump `nonce` to re-trigger. */
export type SourceScrollTarget = { text: string; nonce: number };

type Props = {
  sourceId: string;
  /** Notifies the parent after a successful save (e.g. to mark chunks stale). */
  onSaved?: () => void;
  /** When set/changed, scrolls the document to the matching text ("View in source"). */
  scrollTarget?: SourceScrollTarget | null;
  /** Card evidence quotes to highlight inside the document. */
  cardLinks?: SourceCardLink[];
  /** Card whose highlight should render in the emphasized "active" style. */
  activeCardId?: string | null;
  /** Called when the user clicks a highlighted passage (opens that card). */
  onCardLinkClick?: (cardId: string) => void;
  /** Undo/redo, image insert, and sync status bar. Hidden on Create where the pane is tighter. */
  showToolbar?: boolean;
};

export function SourceDocumentEditor({
  sourceId,
  onSaved,
  scrollTarget,
  cardLinks,
  activeCardId,
  onCardLinkClick,
  showToolbar = true,
}: Props) {
  const [content, setContent] = useState<JSONContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContent(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/sources/${sourceId}/document`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error((await res.text()) || "Could not load source");
        const data = (await res.json()) as { content: JSONContent };
        if (!cancelled) setContent(data.content);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load source");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  if (loading) {
    return (
      <div className="dh-source-doc">
        <div className="dh-source-doc__state">
          <i className="ri-loader-4-line icon-spin" style={{ fontSize: 26 }} />
          <span>Extracting text &amp; images from your source…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dh-source-doc">
        <div className="dh-source-doc__state">
          <i className="ri-error-warning-line" style={{ fontSize: 26 }} />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!content) return null;

  return (
    <SourceDocumentEditorInner
      key={sourceId}
      sourceId={sourceId}
      initialContent={content}
      onSaved={onSaved}
      scrollTarget={scrollTarget}
      cardLinks={cardLinks}
      activeCardId={activeCardId}
      onCardLinkClick={onCardLinkClick}
      showToolbar={showToolbar}
    />
  );
}

function SourceDocumentEditorInner({
  sourceId,
  initialContent,
  onSaved,
  scrollTarget,
  cardLinks,
  activeCardId,
  onCardLinkClick,
  showToolbar = true,
}: {
  sourceId: string;
  initialContent: JSONContent;
  onSaved?: () => void;
  scrollTarget?: SourceScrollTarget | null;
  cardLinks?: SourceCardLink[];
  activeCardId?: string | null;
  onCardLinkClick?: (cardId: string) => void;
  showToolbar?: boolean;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<JSONContent | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onCardLinkClickRef = useRef(onCardLinkClick);
  onCardLinkClickRef.current = onCardLinkClick;
  // Autosave guards: only persist after a real user edit (typing/paste/drag or a
  // toolbar action). This prevents the editor's initial content-load and schema
  // normalization transactions from silently overwriting the stored document.
  const userEditedRef = useRef(false);
  const lastSavedRef = useRef<string>(JSON.stringify(initialContent));
  const markEdited = useCallback(() => {
    userEditedRef.current = true;
  }, []);
  const editorRef = useRef<Editor | null>(null);

  const save = useCallback(
    async (json: JSONContent) => {
      pendingRef.current = null;
      const serialized = JSON.stringify(json);
      setStatus("saving");
      try {
        const res = await fetch(`/api/sources/${sourceId}/document`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: json }),
        });
        if (!res.ok) throw new Error(await res.text());
        lastSavedRef.current = serialized;
        setStatus("saved");
        onSavedRef.current?.();
      } catch {
        setStatus("error");
      }
    },
    [sourceId],
  );

  const extensions = useMemo<Extensions>(
    () => [
      ...getSourceDocumentExtensions({ placeholder: "Edit your extracted notes…" }),
      // Notion-style hover drag handle to reorder blocks (and images).
      GlobalDragHandle.configure({ dragHandleWidth: 24, scrollTreshold: 100 }),
      // Clickable highlights linking passages to the cards generated from them.
      SourceCardLinks,
    ],
    [],
  );

  const editor = useEditor({
    extensions,
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      ...richTextEditorKeydownProps(() => editorRef.current, {
        headings: true,
        headingLevels: [1, 2, 3],
        link: true,
      }),
      attributes: { class: "dh-source-doc__prosemirror" },
      // Real user-input signals; a save can only happen after one of these.
      handleDOMEvents: {
        keydown: () => {
          markEdited();
          return false;
        },
        paste: () => {
          markEdited();
          return false;
        },
        cut: () => {
          markEdited();
          return false;
        },
        drop: () => {
          markEdited();
          return false;
        },
        // Clicking a card-linked highlight opens that card's editor. Skip when
        // the user just finished selecting text across the highlight.
        click: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const link = target?.closest?.(".dh-source-cardlink");
          if (!link) return false;
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) return false;
          const cardId = link.getAttribute("data-card-id");
          if (!cardId || !onCardLinkClickRef.current) return false;
          onCardLinkClickRef.current(cardId);
          return true;
        },
      },
    },
    onUpdate: ({ editor: active }) => {
      if (!userEditedRef.current) return;
      const json = active.getJSON();
      const serialized = JSON.stringify(json);
      if (serialized === lastSavedRef.current) return;
      pendingRef.current = json;
      setStatus("saving");
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void save(json), 900);
    },
  });

  useEffect(() => {
    editorRef.current = editor ?? null;
  }, [editor]);

  // Flush a pending (user) edit when unmounting (e.g. switching decks).
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (pendingRef.current) void save(pendingRef.current);
    };
  }, [save]);

  // "View in source": scroll to and briefly flash the block matching a snippet.
  useEffect(() => {
    const snippet = scrollTarget?.text?.replace(/\s+/g, " ").trim().toLowerCase();
    if (!editor || !snippet) return;
    const root = editor.view.dom as HTMLElement;
    const needle = snippet.slice(0, 48);
    let match: HTMLElement | null = null;
    for (const el of Array.from(root.children) as HTMLElement[]) {
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
      if (text && (text.includes(needle) || needle.includes(text.slice(0, 48)))) {
        match = el;
        break;
      }
    }
    if (!match) return;
    match.scrollIntoView({ behavior: "smooth", block: "center" });
    match.classList.add("dh-source-doc__flash");
    const timer = setTimeout(() => match?.classList.remove("dh-source-doc__flash"), 1800);
    return () => clearTimeout(timer);
  }, [editor, scrollTarget?.nonce, scrollTarget?.text]);

  // Sync card→source highlights into the decoration plugin.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setSourceCardLinks(editor, cardLinks ?? [], activeCardId ?? null);
  }, [editor, cardLinks, activeCardId]);

  const handleImageFile = useCallback(
    async (file: File) => {
      if (!editor) return;
      markEdited();
      setStatus("saving");
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        const res = await fetch(`/api/sources/${sourceId}/media`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { url: string };
        chain(editor).setImage({ src: data.url, alt: file.name }).run();
      } catch {
        setStatus("error");
      }
    },
    [editor, sourceId],
  );

  return (
    <div className="dh-source-doc">
      {showToolbar ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImageFile(file);
              e.target.value = "";
            }}
          />
          <DocHeader
            editor={editor}
            status={status}
            onEdit={markEdited}
            onInsertImage={() => fileInputRef.current?.click()}
          />
        </>
      ) : null}
      {editor ? <DocBubbleToolbar editor={editor} onEdit={markEdited} /> : null}
      <div className="dh-source-doc__content">
        {editor ? <EditorContent editor={editor} /> : null}
      </div>
    </div>
  );
}

function statusLabel(status: SaveStatus): { icon: string; text: string; spin?: boolean } {
  switch (status) {
    case "saving":
      return { icon: "ri-loader-4-line", text: "Saving…", spin: true };
    case "saved":
      return { icon: "ri-check-line", text: "Saved" };
    case "error":
      return { icon: "ri-error-warning-line", text: "Save failed" };
    default:
      return { icon: "ri-cloud-line", text: "Synced" };
  }
}

function ToolButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  onEdit,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Marks the document as user-edited so the change is autosaved. */
  onEdit?: () => void;
}) {
  return (
    <button
      type="button"
      className={`dh-source-doc__btn${active ? " is-active" : ""}`}
      onMouseDown={(e) => {
        e.preventDefault();
        onEdit?.();
      }}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <i className={icon} />
    </button>
  );
}

/** Slim header: history + image insert + autosave status. Text formatting lives
 *  in the inline floating toolbar (and markdown shortcuts), Notion-style. */
function DocHeader({
  editor,
  status,
  onEdit,
  onInsertImage,
}: {
  editor: Editor | null;
  status: SaveStatus;
  onEdit: () => void;
  onInsertImage: () => void;
}) {
  const disabled = !editor;
  const status_ = statusLabel(status);

  return (
    <div className="dh-source-doc__toolbar">
      <ToolButton
        icon="ri-arrow-go-back-line"
        label="Undo"
        disabled={disabled}
        onEdit={onEdit}
        onClick={() => editor && chain(editor).undo().run()}
      />
      <ToolButton
        icon="ri-arrow-go-forward-line"
        label="Redo"
        disabled={disabled}
        onEdit={onEdit}
        onClick={() => editor && chain(editor).redo().run()}
      />
      <span className="dh-source-doc__divider" />
      <ToolButton
        icon="ri-image-add-line"
        label="Insert image"
        disabled={disabled}
        onEdit={onEdit}
        onClick={onInsertImage}
      />
      <span className="dh-source-doc__hint">Select text to format · drag the handle to reorder</span>
      <span className="dh-source-doc__status">
        <i className={`${status_.icon}${status_.spin ? " icon-spin" : ""}`} />
        {status_.text}
      </span>
    </div>
  );
}

/** Inline (floating) formatting toolbar that appears over the current selection. */
function DocBubbleToolbar({ editor, onEdit }: { editor: Editor; onEdit: () => void }) {
  const toggleLink = () => {
    onEdit();
    if (editor.isActive("link")) {
      chain(editor).extendMarkRange("link").unsetLink().run();
      return;
    }
    const url = window.prompt("Link URL")?.trim();
    if (!url) return;
    chain(editor).extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="sourceDocBubble"
      tippyOptions={BUBBLE_TIPPY_OPTIONS}
      className="dh-source-doc__bubble"
      shouldShow={({ editor: ed, state }) => {
        const { from, to, empty } = state.selection;
        if (empty || from === to) return false;
        if (ed.isActive("image")) return false;
        return ed.isEditable;
      }}
    >
      <ToolButton
        icon="ri-h-1"
        label="Heading 1"
        active={editor.isActive("heading", { level: 1 })}
        onEdit={onEdit}
        onClick={() => chain(editor).toggleHeading({ level: 1 }).run()}
      />
      <ToolButton
        icon="ri-h-2"
        label="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onEdit={onEdit}
        onClick={() => chain(editor).toggleHeading({ level: 2 }).run()}
      />
      <ToolButton
        icon="ri-h-3"
        label="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onEdit={onEdit}
        onClick={() => chain(editor).toggleHeading({ level: 3 }).run()}
      />
      <span className="dh-source-doc__divider" />
      <ToolButton
        icon="ri-bold"
        label="Bold"
        active={editor.isActive("bold")}
        onEdit={onEdit}
        onClick={() => chain(editor).toggleBold().run()}
      />
      <ToolButton
        icon="ri-italic"
        label="Italic"
        active={editor.isActive("italic")}
        onEdit={onEdit}
        onClick={() => chain(editor).toggleItalic().run()}
      />
      <ToolButton
        icon="ri-underline"
        label="Underline"
        active={editor.isActive("underline")}
        onEdit={onEdit}
        onClick={() => chain(editor).toggleUnderline().run()}
      />
      <span className="dh-source-doc__divider" />
      <ToolButton
        icon="ri-list-unordered"
        label="Bulleted list"
        active={editor.isActive("bulletList")}
        onEdit={onEdit}
        onClick={() => chain(editor).toggleBulletList().run()}
      />
      <ToolButton
        icon="ri-list-ordered"
        label="Numbered list"
        active={editor.isActive("orderedList")}
        onEdit={onEdit}
        onClick={() => chain(editor).toggleOrderedList().run()}
      />
      <ToolButton
        icon="ri-double-quotes-l"
        label="Quote"
        active={editor.isActive("blockquote")}
        onEdit={onEdit}
        onClick={() => chain(editor).toggleBlockquote().run()}
      />
      <span className="dh-source-doc__divider" />
      <ToolButton
        icon="ri-link"
        label="Link"
        active={editor.isActive("link")}
        onClick={toggleLink}
      />
    </BubbleMenu>
  );
}
