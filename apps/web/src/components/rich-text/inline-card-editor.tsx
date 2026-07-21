"use client";

import {
  buildCardRichTextContent,
  getCardEditorExtensions,
  looksLikeMarkdownPaste,
  markdownToRichTextJson,
  normalizeEditorValue,
  richTextEditorKeydownProps,
  type CardRichTextContent,
} from "@deephaus/rich-text";
import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useLayoutEffect, useState } from "react";
import { downloadImage, ImageCropDialog } from "@/components/image-crop-dialog";
import { FloatingEditorToolbar } from "./floating-editor-toolbar";
import { LinkHoverEditor } from "./link-hover-editor";
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
  /**
   * Upload an image file and return a public URL. When provided, the editor
   * supports insert-image (toolbar), paste, and drop — same as source/notes.
   */
  uploadImage?: (file: File) => Promise<string>;
};

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
type ImageActionDetail = {
  action: "crop" | "download";
  src: string;
  pos: number;
};

function isImageFile(file: File): boolean {
  if (!file.type.startsWith("image/") || file.type.includes("svg")) return false;
  return IMAGE_ACCEPT.split(",").some((t) => t === file.type) || /^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type);
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

export function InlineCardEditor({
  instanceKey = "default",
  clozeEnabled = false,
  ...props
}: InlineCardEditorProps) {
  // Remount when instance or cloze mode changes — extensions are fixed at create time.
  const mountKey = `${instanceKey}:${clozeEnabled ? "cloze" : "plain"}`;
  return (
    <InlineCardEditorInner
      key={mountKey}
      instanceKey={mountKey}
      clozeEnabled={clozeEnabled}
      {...props}
    />
  );
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
  uploadImage,
}: InlineCardEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const uploadImageRef = useRef(uploadImage);
  uploadImageRef.current = uploadImage;

  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const formatPluginKey = `formatToolbar:${instanceKey}`;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<{ src: string; pos: number } | null>(null);

  const normalized = useMemo(() => normalizeEditorValue(value), [value]);
  const initialContent = normalized.json;

  const extensions = useMemo(
    () => getCardEditorExtensions({ placeholder, clozeEnabled }),
    [placeholder, clozeEnabled],
  );

  const lastExternalMarkdown = useRef(normalized.markdown);

  const insertUploadedImage = useCallback(async (file: File) => {
    const upload = uploadImageRef.current;
    const active = editorRef.current;
    if (!upload || !active || active.isDestroyed || !isImageFile(file)) return false;
    setUploading(true);
    setUploadError(null);
    try {
      const url = await upload(file);
      if (!mountedRef.current || active.isDestroyed) return true;
      // Image commands come from @deephaus/rich-text; cast the chain locally.
      (
        active.chain().focus() as unknown as {
          setImage: (attrs: { src: string; alt?: string }) => { run: () => boolean };
        }
      )
        .setImage({ src: url, alt: file.name || "image" })
        .run();
      return true;
    } catch (error) {
      if (mountedRef.current) {
        setUploadError(error instanceof Error ? error.message : "Upload failed");
      }
      return true;
    } finally {
      if (mountedRef.current) setUploading(false);
    }
  }, []);

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable: !readOnly,
    autofocus: autoFocus ? "end" : false,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      ...richTextEditorKeydownProps(() => editorRef.current, {
        headings: false,
        cloze: clozeEnabled,
        link: true,
      }),
      attributes: {
        class: "dh-inline-card-editor__prosemirror",
      },
      handlePaste: (_view, event) => {
        const activeEditor = editorRef.current;
        if (!activeEditor) return false;

        if (uploadImageRef.current) {
          const image = imageFileFromDataTransfer(event.clipboardData);
          if (image) {
            event.preventDefault();
            void insertUploadedImage(image);
            return true;
          }
        }

        const text = event.clipboardData?.getData("text/plain")?.trim();
        if (!text || !looksLikeMarkdownPaste(text)) return false;
        event.preventDefault();
        const json = markdownToRichTextJson(text);
        activeEditor.commands.insertContent(json.content ?? []);
        return true;
      },
      handleDrop: (_view, event) => {
        if (!uploadImageRef.current) return false;
        const image = imageFileFromDataTransfer(event.dataTransfer);
        if (!image) return false;
        event.preventDefault();
        void insertUploadedImage(image);
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

  useEffect(() => {
    if (!editor || editor.isDestroyed || readOnly) return;
    const root = editor.view.dom;
    const onImageAction = (event: Event) => {
      const detail = (event as CustomEvent<ImageActionDetail>).detail;
      if (!detail?.src || !Number.isInteger(detail.pos)) return;
      if (detail.action === "crop") {
        setCropTarget({ src: detail.src, pos: detail.pos });
      } else {
        const attrs = editor.state.doc.nodeAt(detail.pos)?.attrs;
        const filename =
          (typeof attrs?.alt === "string" && attrs.alt.trim()) || "card-image";
        void downloadImage(detail.src, filename);
      }
    };
    root.addEventListener("deephaus:image-action", onImageAction);
    return () => root.removeEventListener("deephaus:image-action", onImageAction);
  }, [editor, readOnly]);

  const saveCroppedImage = useCallback(
    async (file: File) => {
      const upload = uploadImageRef.current;
      const active = editorRef.current;
      if (!upload || !active || active.isDestroyed || !cropTarget) return;
      setUploading(true);
      setUploadError(null);
      try {
        const url = await upload(file);
        const node = active.state.doc.nodeAt(cropTarget.pos);
        if (!node || node.type.name !== "image") {
          throw new Error("The image is no longer available.");
        }
        active.view.dispatch(
          active.state.tr
            .setNodeMarkup(
              cropTarget.pos,
              undefined,
              { ...node.attrs, src: url, aspectRatio: null },
              node.marks,
            )
            .setMeta("resizableImage", true),
        );
      } catch (cause) {
        setUploadError(cause instanceof Error ? cause.message : "Crop failed");
        throw cause;
      } finally {
        setUploading(false);
      }
    },
    [cropTarget],
  );

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
    editor.setEditable(!readOnly && !uploading);
  }, [editor, readOnly, uploading]);

  const busy = readOnly || uploading;

  return (
    <div
      className={`dh-inline-card-editor${busy ? " dh-inline-card-editor--readonly" : ""}${className ? ` ${className}` : ""}`}
      onBlur={() => {
        if (!editor || editor.isDestroyed || !mountedRef.current) return;
        const content = buildCardRichTextContent(editor.getJSON());
        lastExternalMarkdown.current = content.markdown;
        onChangeRef.current(content);
      }}
    >
      {uploadImage ? (
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          style={{ display: "none" }}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void insertUploadedImage(file);
            event.target.value = "";
          }}
        />
      ) : null}
      {editor ? (
        <div className="dh-inline-card-editor__menus">
          <FloatingEditorToolbar
            editor={editor}
            disabled={busy}
            clozeEnabled={clozeEnabled}
            menuPluginKey={formatPluginKey}
            onInsertImage={
              uploadImage
                ? () => {
                    fileInputRef.current?.click();
                  }
                : undefined
            }
          />
          {!busy ? <LinkHoverEditor editor={editor} /> : null}
        </div>
      ) : null}
      <div className="dh-inline-card-editor__content">
        {editor ? <EditorContent editor={editor} /> : null}
      </div>
      {uploading ? <div className="dh-inline-card-editor__upload-status">Uploading image…</div> : null}
      {uploadError ? <div className="dh-inline-card-editor__upload-error">{uploadError}</div> : null}
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
