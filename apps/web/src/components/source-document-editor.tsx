"use client";

import {
  getSourceDocumentExtensions,
  handleRichTextKeydown,
  looksLikeMarkdownPaste,
  markdownToRichTextJson,
} from "@deephaus/rich-text";
import type { Extensions, JSONContent } from "@tiptap/core";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import GlobalDragHandle from "tiptap-extension-global-drag-handle";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  SourceCardLinks,
  setSourceCardLinks,
  type SourceCardLink,
} from "@/components/source-card-links";
import { downloadImage, ImageCropDialog } from "@/components/image-crop-dialog";
import { LinkHoverEditor } from "@/components/rich-text/link-hover-editor";
import { RichTextBubbleToolbar } from "@/components/rich-text/rich-text-bubble-toolbar";
import { useSlashMenu } from "@/components/rich-text/slash-command-menu";
import { TableMenu } from "@/components/rich-text/table-menu";
import { DocumentSkeleton } from "@/components/ui/skeleton-patterns";
import { formatShortcut, useModKeyLabel } from "@/lib/keyboard-shortcuts";
import {
  getCachedSourceDocument,
  prefetchSourceDocument,
  setCachedSourceDocument,
} from "@/lib/sources/source-document-cache";
import "@/components/rich-text/rich-text.css";
import "./source-document-editor.css";

type SaveStatus = "idle" | "saving" | "saved" | "error";
type ImageActionDetail = {
  action: "occlusion" | "crop" | "download";
  src: string;
  pos: number;
};
type SourceExtractionProgress = {
  status: "pending" | "processing" | "ready" | "failed";
  phase: string;
  pages_total: number | null;
  pages_completed: number;
  error: string | null;
};

const IMAGE_MIME = /^(image\/(png|jpeg|jpg|webp|gif))$/i;

function isImageFile(file: File): boolean {
  return IMAGE_MIME.test(file.type) || (file.type.startsWith("image/") && !file.type.includes("svg"));
}

/** Screenshots often land in `items`, not `files`. */
function imageFileFromDataTransfer(data: DataTransfer | null | undefined): File | null {
  if (!data) return null;
  if (data.items?.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind !== "file") continue;
      if (!item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file && isImageFile(file)) return file;
    }
  }
  if (data.files?.length) {
    return Array.from(data.files).find(isImageFile) ?? null;
  }
  return null;
}

function extractionProgressLabel(progress: SourceExtractionProgress): string {
  if (progress.pages_total) {
    return `Extracting page ${Math.min(progress.pages_completed, progress.pages_total)} of ${progress.pages_total}…`;
  }
  const phase = progress.phase.replace(/-/g, " ").trim();
  return phase ? `${phase[0]!.toUpperCase()}${phase.slice(1)}…` : "Extracting source…";
}

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
  setTextSelection: (range: { from: number; to: number }) => DocChain;
  insertLatexInline: (formula?: string) => DocChain;
  insertLatexBlock: (formula?: string) => DocChain;
};
function chain(editor: Editor): DocChain {
  return editor.chain().focus() as unknown as DocChain;
}

/** A snippet to scroll to + briefly highlight; bump `nonce` to re-trigger. */
export type SourceScrollTarget = { text: string; nonce: number };
export type SourceImageSelection = {
  imageUrl: string;
  sourceRef: string | null;
};

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
  /** Generate flashcards from the current text selection (Create page). */
  onGenerateFromSelection?: (text: string) => void;
  /** Disable the selection Generate action while a job is already running. */
  generateFromSelectionDisabled?: boolean;
  /** Starts reviewed image-occlusion creation from the selected source image. */
  onCreateOcclusionFromImage?: (selection: SourceImageSelection) => void | Promise<void>;
  createOcclusionDisabled?: boolean;
};

export function SourceDocumentEditor({
  sourceId,
  onSaved,
  scrollTarget,
  cardLinks,
  activeCardId,
  onCardLinkClick,
  showToolbar = true,
  onGenerateFromSelection,
  generateFromSelectionDisabled = false,
  onCreateOcclusionFromImage,
  createOcclusionDisabled = false,
}: Props) {
  const cached = getCachedSourceDocument(sourceId);
  const [activeSourceId, setActiveSourceId] = useState(sourceId);
  const [content, setContent] = useState<JSONContent | null>(cached?.content ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);
  const [extractionProgress, setExtractionProgress] =
    useState<SourceExtractionProgress | null>(null);

  // Keep state in sync with sourceId during render so deck switches don't flash
  // the previous document for a frame.
  if (activeSourceId !== sourceId) {
    setActiveSourceId(sourceId);
    const hit = getCachedSourceDocument(sourceId);
    setContent(hit?.content ?? null);
    setLoading(!hit);
    setError(null);
    setExtractionProgress(null);
  }

  useEffect(() => {
    let cancelled = false;
    if (getCachedSourceDocument(sourceId)) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const fresh = await prefetchSourceDocument(sourceId);
        if (cancelled) return;
        if (!fresh) throw new Error("Could not load source");
        setContent(fresh.content);
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

  useEffect(() => {
    if (!loading || getCachedSourceDocument(sourceId)) {
      setExtractionProgress(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/sources/${sourceId}/extraction`, {
          credentials: "include",
        });
        if (response.status === 404) return;
        if (!response.ok) throw new Error("Could not load extraction progress.");
        const progress = (await response.json()) as SourceExtractionProgress;
        if (cancelled) return;
        if (progress.status === "failed") {
          setError(progress.error ?? "Source extraction failed.");
          setLoading(false);
          return;
        }
        if (progress.status === "ready") {
          setExtractionProgress(null);
          return;
        }
        setExtractionProgress(progress);
        timer = setTimeout(() => void poll(), 1000);
      } catch {
        if (!cancelled) timer = setTimeout(() => void poll(), 2000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [loading, sourceId]);

  if (loading) {
    return (
      <div className="dh-source-doc" aria-busy aria-label={extractionProgress ? extractionProgressLabel(extractionProgress) : "Loading source"}>
        <DocumentSkeleton />
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
      onGenerateFromSelection={onGenerateFromSelection}
      generateFromSelectionDisabled={generateFromSelectionDisabled}
      onCreateOcclusionFromImage={onCreateOcclusionFromImage}
      createOcclusionDisabled={createOcclusionDisabled}
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
  onGenerateFromSelection,
  generateFromSelectionDisabled = false,
  onCreateOcclusionFromImage,
  createOcclusionDisabled = false,
}: {
  sourceId: string;
  initialContent: JSONContent;
  onSaved?: () => void;
  scrollTarget?: SourceScrollTarget | null;
  cardLinks?: SourceCardLink[];
  activeCardId?: string | null;
  onCardLinkClick?: (cardId: string) => void;
  showToolbar?: boolean;
  onGenerateFromSelection?: (text: string) => void;
  generateFromSelectionDisabled?: boolean;
  onCreateOcclusionFromImage?: (selection: SourceImageSelection) => void | Promise<void>;
  createOcclusionDisabled?: boolean;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [cropTarget, setCropTarget] = useState<{ src: string; pos: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<JSONContent | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onCardLinkClickRef = useRef(onCardLinkClick);
  onCardLinkClickRef.current = onCardLinkClick;
  const onGenerateFromSelectionRef = useRef(onGenerateFromSelection);
  onGenerateFromSelectionRef.current = onGenerateFromSelection;
  const generateFromSelectionDisabledRef = useRef(generateFromSelectionDisabled);
  generateFromSelectionDisabledRef.current = generateFromSelectionDisabled;
  const onCreateOcclusionFromImageRef = useRef(onCreateOcclusionFromImage);
  onCreateOcclusionFromImageRef.current = onCreateOcclusionFromImage;
  // Autosave guards: only persist after a real user edit (typing/paste/drag or a
  // toolbar action). This prevents the editor's initial content-load and schema
  // normalization transactions from silently overwriting the stored document.
  const userEditedRef = useRef(false);
  const lastSavedRef = useRef<string>(JSON.stringify(initialContent));
  const markEdited = useCallback(() => {
    userEditedRef.current = true;
  }, []);
  const editorRef = useRef<Editor | null>(null);
  const insertImageFileRef = useRef<(file: File) => Promise<void>>(async () => {});

  const save = useCallback(
    async (json: JSONContent): Promise<boolean> => {
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
        setCachedSourceDocument(sourceId, json);
        setStatus("saved");
        onSavedRef.current?.();
        return true;
      } catch {
        setStatus("error");
        return false;
      }
    },
    [sourceId],
  );

  // Notion-style "/" insert menu (popup rendered below).
  const { extension: slashExtension, menu: slashMenu } = useSlashMenu({
    onInsertImage: () => fileInputRef.current?.click(),
    onEdit: markEdited,
  });

  const extensions = useMemo<Extensions>(
    () => [
      ...getSourceDocumentExtensions({
        placeholder: "Type '/' for blocks, or start writing…",
        imageActions: onCreateOcclusionFromImage
          ? ["occlusion", "crop", "download"]
          : ["crop", "download"],
      }),
      // Notion-style hover drag handle to reorder blocks (and images).
      GlobalDragHandle.configure({ dragHandleWidth: 24, scrollTreshold: 100 }),
      // Clickable highlights linking passages to the cards generated from them.
      SourceCardLinks,
      slashExtension,
    ],
    [onCreateOcclusionFromImage, slashExtension],
  );

  const editor = useEditor({
    extensions,
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "dh-source-doc__prosemirror" },
      handleKeyDown: (_view, event) => {
        const active = editorRef.current;
        if (!active || active.isDestroyed) return false;
        if (
          handleRichTextKeydown(active, event, {
            headings: true,
            headingLevels: [1, 2, 3],
            link: true,
          })
        ) {
          return true;
        }
        // Mod+Shift+G — generate flashcards from the current selection.
        const mod = event.metaKey || event.ctrlKey;
        if (
          !mod ||
          !event.shiftKey ||
          event.altKey ||
          event.key.toLowerCase() !== "g"
        ) {
          return false;
        }
        const generate = onGenerateFromSelectionRef.current;
        if (!generate) return false;
        const { from, to } = active.state.selection;
        if (from === to) return false;
        const selected = active.state.doc.textBetween(from, to, "\n").trim();
        if (selected.length < 20) {
          event.preventDefault();
          window.alert("Select at least 20 characters to generate flashcards.");
          return true;
        }
        event.preventDefault();
        if (!generateFromSelectionDisabledRef.current) generate(selected);
        return true;
      },
      handlePaste: (_view, event) => {
        const active = editorRef.current;
        if (!active) return false;

        const image = imageFileFromDataTransfer(event.clipboardData);
        if (image) {
          markEdited();
          event.preventDefault();
          void insertImageFileRef.current(image);
          return true;
        }

        const text = event.clipboardData?.getData("text/plain")?.trim();
        if (!text || !looksLikeMarkdownPaste(text)) return false;
        markEdited();
        event.preventDefault();
        const json = markdownToRichTextJson(text);
        active.commands.insertContent(json.content ?? []);
        return true;
      },
      handleDrop: (_view, event) => {
        const image = imageFileFromDataTransfer(event.dataTransfer);
        if (!image) return false;
        markEdited();
        event.preventDefault();
        void insertImageFileRef.current(image);
        return true;
      },
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
        pointerdown: (_view, event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest?.("[data-resize-handle]")) markEdited();
          return false;
        },
        // Hyperlinks open in a new tab on click. Card-linked highlights open
        // that card. Skip both when the user just finished selecting text.
        click: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) return false;

          const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
          if (anchor?.href) {
            event.preventDefault();
            window.open(anchor.href, "_blank", "noopener,noreferrer");
            return true;
          }

          const cardLink = target?.closest?.(".dh-source-cardlink");
          if (!cardLink) return false;
          const cardId = cardLink.getAttribute("data-card-id");
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
    onTransaction: ({ transaction }) => {
      if (transaction.getMeta("resizableImage")) markEdited();
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
      if (!editor || !isImageFile(file)) return;
      markEdited();
      setStatus("saving");
      try {
        const form = new FormData();
        const filename =
          file.name && file.name !== "image.png" && file.name !== "blob"
            ? file.name
            : `paste-${Date.now()}.${(file.type.split("/")[1] || "png").replace("jpeg", "jpg")}`;
        form.append("file", file, filename);
        const res = await fetch(`/api/sources/${sourceId}/media`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { url: string };
        chain(editor).setImage({ src: data.url, alt: filename }).run();
      } catch {
        setStatus("error");
      }
    },
    [editor, sourceId, markEdited],
  );
  insertImageFileRef.current = handleImageFile;

  const createOcclusionFromSelectedImage = useCallback(async () => {
    if (!editor || createOcclusionDisabled) return;
    const attrs = editor.getAttributes("image") as {
      src?: unknown;
      alt?: unknown;
      title?: unknown;
    };
    const imageUrl = typeof attrs.src === "string" ? attrs.src.trim() : "";
    if (!imageUrl) return;

    const json = editor.getJSON();
    const serialized = JSON.stringify(json);
    if (serialized !== lastSavedRef.current) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      pendingRef.current = json;
      const saved = await save(json);
      if (!saved) return;
    }

    const sourceRefValue =
      typeof attrs.title === "string" && attrs.title.trim()
        ? attrs.title.trim()
        : typeof attrs.alt === "string" && attrs.alt.trim()
          ? attrs.alt.trim()
          : null;
    await onCreateOcclusionFromImageRef.current?.({
      imageUrl,
      sourceRef: sourceRefValue,
    });
  }, [createOcclusionDisabled, editor, save]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const root = editor.view.dom;
    const onImageAction = (event: Event) => {
      const detail = (event as CustomEvent<ImageActionDetail>).detail;
      if (!detail?.src || !Number.isInteger(detail.pos)) return;
      if (detail.action === "occlusion") {
        editor.commands.setNodeSelection(detail.pos);
        void createOcclusionFromSelectedImage();
      } else if (detail.action === "crop") {
        setCropTarget({ src: detail.src, pos: detail.pos });
      } else {
        const attrs = editor.state.doc.nodeAt(detail.pos)?.attrs;
        const filename =
          (typeof attrs?.alt === "string" && attrs.alt.trim()) ||
          (typeof attrs?.title === "string" && attrs.title.trim()) ||
          "source-image";
        void downloadImage(detail.src, filename);
      }
    };
    root.addEventListener("deephaus:image-action", onImageAction);
    return () => root.removeEventListener("deephaus:image-action", onImageAction);
  }, [createOcclusionFromSelectedImage, editor]);

  const saveCroppedImage = useCallback(
    async (file: File) => {
      if (!editor || !cropTarget) return;
      setStatus("saving");
      try {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch(`/api/sources/${sourceId}/media`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!response.ok) throw new Error(await response.text());
        const { url } = (await response.json()) as { url: string };
        const node = editor.state.doc.nodeAt(cropTarget.pos);
        if (!node || node.type.name !== "image") {
          throw new Error("The image is no longer available.");
        }
        markEdited();
        editor.view.dispatch(
          editor.state.tr
            .setNodeMarkup(
              cropTarget.pos,
              undefined,
              { ...node.attrs, src: url, aspectRatio: null },
              node.marks,
            )
            .setMeta("resizableImage", true),
        );
      } catch (cause) {
        setStatus("error");
        throw cause;
      }
    },
    [cropTarget, editor, markEdited, sourceId],
  );

  return (
    <div className="dh-source-doc">
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
      {showToolbar ? (
        <DocHeader
          editor={editor}
          status={status}
          onEdit={markEdited}
          onInsertImage={() => fileInputRef.current?.click()}
        />
      ) : null}
      {editor ? (
        <>
          <RichTextBubbleToolbar
            editor={editor}
            onEdit={markEdited}
            onGenerateFromSelection={onGenerateFromSelection}
            generateFromSelectionDisabled={generateFromSelectionDisabled}
            headingLevels={[1, 2, 3]}
            showCode
            showBlockquote
            onInsertImage={() => fileInputRef.current?.click()}
            menuPluginKey="sourceDocBubble"
          />
          <LinkHoverEditor editor={editor} onEdit={markEdited} />
          <TableMenu editor={editor} onEdit={markEdited} />
        </>
      ) : null}
      {slashMenu}
      <div className="dh-source-doc__content">
        {editor ? <EditorContent editor={editor} /> : null}
      </div>
      {cropTarget ? (
        <ImageCropDialog
          imageUrl={cropTarget.src}
          onClose={() => setCropTarget(null)}
          onCrop={saveCroppedImage}
        />
      ) : null}
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
  shortcut,
  onClick,
  active = false,
  disabled = false,
  onEdit,
}: {
  icon: string;
  label: string;
  /** Compact shortcut shown in the hover label (e.g. ⌘B). */
  shortcut?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  /** Marks the document as user-edited so the change is autosaved. */
  onEdit?: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const aria = shortcut ? `${label} (${shortcut})` : label;

  useLayoutEffect(() => {
    if (!hover || !btnRef.current) {
      setCoords(null);
      return;
    }
    const update = () => {
      const rect = btnRef.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({
        top: rect.top - 6,
        left: rect.left + rect.width / 2,
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [hover]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`dh-source-doc__btn${active ? " is-active" : ""}`}
        onMouseDown={(e) => {
          e.preventDefault();
          onEdit?.();
        }}
        onClick={onClick}
        disabled={disabled}
        aria-label={aria}
        onMouseEnter={() => {
          if (!disabled) setHover(true);
        }}
        onMouseLeave={() => setHover(false)}
        onFocus={() => {
          if (!disabled) setHover(true);
        }}
        onBlur={() => setHover(false)}
      >
        <i className={icon} aria-hidden />
      </button>
      {hover && coords
        ? createPortal(
            <span
              className="dh-source-doc__btn-hover-label is-visible"
              role="tooltip"
              style={{ top: coords.top, left: coords.left }}
            >
              <span>{label}</span>
              {shortcut ? (
                <span className="dh-source-doc__btn-hover-shortcut">{shortcut}</span>
              ) : null}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

/** Mod + optional Shift/Alt + key, matching rich-text editor shortcuts. */
function editorShortcut(
  mod: string,
  key: string,
  opts?: { shift?: boolean; alt?: boolean },
): string {
  if (mod === "⌘") {
    return `${mod}${opts?.alt ? "⌥" : ""}${opts?.shift ? "⇧" : ""}${key}`;
  }
  const parts = [mod];
  if (opts?.alt) parts.push("Alt");
  if (opts?.shift) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
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
  const mod = useModKeyLabel();

  return (
    <div className="dh-source-doc__toolbar">
      <ToolButton
        icon="ri-arrow-go-back-line"
        label="Undo"
        shortcut={formatShortcut(mod, "Z")}
        disabled={disabled}
        onEdit={onEdit}
        onClick={() => editor && chain(editor).undo().run()}
      />
      <ToolButton
        icon="ri-arrow-go-forward-line"
        label="Redo"
        shortcut={editorShortcut(mod, "Z", { shift: true })}
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
      <ToolButton
        icon="ri-formula"
        label="Inline LaTeX"
        shortcut="$…$"
        disabled={disabled}
        onEdit={onEdit}
        onClick={() => editor && chain(editor).insertLatexInline("x").run()}
      />
      <ToolButton
        icon="ri-functions"
        label="Block LaTeX"
        shortcut="$$…$$"
        disabled={disabled}
        onEdit={onEdit}
        onClick={() => editor && chain(editor).insertLatexBlock("\\frac{a}{b}").run()}
      />
      <span className="dh-source-doc__hint">
        Select text to format · type $…$ or $$…$$ for LaTeX · drag to reorder
      </span>
      <span className="dh-source-doc__status">
        <i className={`${status_.icon}${status_.spin ? " icon-spin" : ""}`} />
        {status_.text}
      </span>
    </div>
  );
}

