"use client";

import {
  buildOcclusionCardFront,
  imageUrlFromCardFields,
  parseImageOcclusionData,
  type ImageOcclusionData,
} from "@deephaus/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageOcclusionEditor } from "@/components/image-occlusion/image-occlusion-editor";
import { apiFetch } from "@/lib/api/fetch";
import { occlusionDataEqual } from "@/lib/occlusion/sync-occlusion-data";

type Props = {
  cardId: string;
  front: string | null;
  back: string | null;
  occlusionData: unknown;
  disabled?: boolean;
  onChange: (patch: {
    type: "image-occlusion";
    front: string;
    back: string | null;
    occlusion_data: ImageOcclusionData;
  }) => void;
};

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

function headerFromFront(front: string | null | undefined): string {
  return (front ?? "").replace(/!\[[^\]]*\]\([^)]+\)/g, "").trim();
}

function occlusionDataFromProps(
  occlusionData: unknown,
  imageUrl: string | null,
): ImageOcclusionData | null {
  const parsed = parseImageOcclusionData(occlusionData);
  if (parsed) return parsed;
  if (imageUrl) return { imageUrl, rects: [] };
  return null;
}

function isImageFile(file: File): boolean {
  if (!file.type.startsWith("image/") || file.type.includes("svg")) return false;
  return (
    IMAGE_ACCEPT.split(",").some((type) => type === file.type) ||
    /^image\/(png|jpeg|jpg|webp|gif)$/i.test(file.type)
  );
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

export function ImageOcclusionCardSection({
  cardId,
  front,
  back,
  occlusionData,
  disabled,
  onChange,
}: Props) {
  const imageUrl = useMemo(
    () => parseImageOcclusionData(occlusionData)?.imageUrl ?? imageUrlFromCardFields(front, back),
    [occlusionData, front, back],
  );

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<ImageOcclusionData | null>(() =>
    occlusionDataFromProps(occlusionData, imageUrl),
  );
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectError, setAutoDetectError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [header, setHeader] = useState(() => headerFromFront(front));

  const lastEmittedRef = useRef<string | null>(null);
  const userEditRef = useRef(false);
  const cardIdRef = useRef(cardId);

  const emit = useCallback(
    (next: ImageOcclusionData, nextHeader = header) => {
      lastEmittedRef.current = JSON.stringify(next);
      onChangeRef.current({
        type: "image-occlusion",
        front: buildOcclusionCardFront(next.imageUrl, nextHeader),
        back: back ?? null,
        occlusion_data: next,
      });
    },
    [back, header],
  );

  useEffect(() => {
    const isNewCard = cardIdRef.current !== cardId;
    if (isNewCard) {
      cardIdRef.current = cardId;
      userEditRef.current = false;
      const nextData = occlusionDataFromProps(occlusionData, imageUrl);
      setData(nextData);
      setHeader(headerFromFront(front));
      setAutoDetectError(null);
      setUploadError(null);
      lastEmittedRef.current = nextData ? JSON.stringify(nextData) : null;
      return;
    }
    if (userEditRef.current) return;

    const nextData = occlusionDataFromProps(occlusionData, imageUrl);
    setData((prev) => (occlusionDataEqual(prev, nextData) ? prev : nextData));
    if (nextData) {
      lastEmittedRef.current = JSON.stringify(nextData);
    }
    const nextHeader = headerFromFront(front);
    setHeader((prev) => (prev === nextHeader ? prev : nextHeader));
  }, [cardId, occlusionData, imageUrl, front]);

  const handleEditorChange = useCallback((next: ImageOcclusionData) => {
    userEditRef.current = true;
    setData(next);
  }, []);

  useEffect(() => {
    if (!data || !userEditRef.current) return;

    const serialized = JSON.stringify(data);
    if (serialized === lastEmittedRef.current) {
      userEditRef.current = false;
      return;
    }

    const timer = window.setTimeout(() => {
      userEditRef.current = false;
      emit(data);
    }, 280);
    return () => clearTimeout(timer);
  }, [data, emit]);

  const applyUploadedImage = useCallback(
    (url: string) => {
      const next: ImageOcclusionData = { imageUrl: url, rects: [] };
      userEditRef.current = false;
      setData(next);
      setUploadError(null);
      setAutoDetectError(null);
      emit(next);
    },
    [emit],
  );

  const uploadImageFile = useCallback(
    async (file: File) => {
      if (disabled || uploading) return;
      if (!isImageFile(file)) {
        setUploadError("Unsupported image type. Use JPEG, PNG, WebP, or GIF.");
        return;
      }

      setUploading(true);
      setUploadError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/cards/${cardId}/media`, {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Upload failed");
        }
        const body = (await res.json()) as { url: string };
        applyUploadedImage(body.url);
      } catch (cause) {
        setUploadError(cause instanceof Error ? cause.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [applyUploadedImage, cardId, disabled, uploading],
  );

  useEffect(() => {
    if (disabled || data) return;

    function onPaste(event: ClipboardEvent) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const image = imageFileFromDataTransfer(event.clipboardData);
      if (!image) return;
      event.preventDefault();
      void uploadImageFile(image);
    }

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [data, disabled, uploadImageFile]);

  async function runAutoDetect() {
    setAutoDetecting(true);
    setAutoDetectError(null);
    try {
      const res = await apiFetch(`/api/cards/${cardId}/occlusion/auto-detect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ occlusion_data: data }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message =
          typeof body?.error === "string"
            ? body.error
            : res.status === 401
              ? "Your session expired. Refresh the page and sign in again."
              : "Auto-detect failed";
        setAutoDetectError(message);
        return;
      }
      const body = (await res.json()) as { occlusion_data: ImageOcclusionData };
      userEditRef.current = false;
      setData(body.occlusion_data);
      emit(body.occlusion_data);
    } catch {
      setAutoDetectError("Auto-detect failed. Check your connection and try again.");
    } finally {
      setAutoDetecting(false);
    }
  }

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept={IMAGE_ACCEPT}
      style={{ display: "none" }}
      disabled={disabled || uploading}
      onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) void uploadImageFile(file);
        event.target.value = "";
      }}
    />
  );

  if (!imageUrl || !data) {
    return (
      <div style={s.emptyRoot}>
        {fileInput}
        <div
          ref={dropzoneRef}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || uploading}
          aria-label="Upload an image for occlusion"
          style={{
            ...s.dropzone,
            ...(dragOver ? s.dropzoneActive : {}),
            ...(disabled || uploading ? s.dropzoneDisabled : {}),
          }}
          onClick={() => {
            if (!disabled && !uploading) fileInputRef.current?.click();
          }}
          onKeyDown={(event) => {
            if (disabled || uploading) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setDragOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            if (disabled) return;
            const image = imageFileFromDataTransfer(event.dataTransfer);
            if (image) void uploadImageFile(image);
          }}
        >
          <i
            className={uploading ? "ri-loader-4-line icon-spin" : "ri-image-add-line"}
            style={s.dropzoneIcon}
            aria-hidden
          />
          <span style={s.dropzoneTitle}>
            {uploading ? "Uploading image…" : "Upload an image"}
          </span>
          <span style={s.dropzoneHint}>
            Click to choose a file, paste a screenshot, or drag and drop
          </span>
          <span style={s.dropzoneHint}>JPEG, PNG, WebP, or GIF · up to 5 MB</span>
        </div>
        {uploadError ? (
          <p role="alert" style={s.error}>
            {uploadError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {fileInput}
      <div style={s.titleRow}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
          <span className="field-label">Card title (optional)</span>
          <input
            className="input"
            value={header ?? ""}
            disabled={disabled || uploading}
            placeholder="Shown above the image"
            onChange={(e) => {
              const nextHeader = e.target.value;
              setHeader(nextHeader);
              emit(data, nextHeader);
            }}
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={s.changeImageBtn}
          disabled={disabled || uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? (
            <i className="ri-loader-4-line icon-spin" aria-hidden />
          ) : (
            <i className="ri-image-edit-line" aria-hidden />
          )}
          Change image
        </button>
      </div>
      <ImageOcclusionEditor
        data={data}
        disabled={disabled || uploading}
        autoDetecting={autoDetecting}
        onAutoDetect={runAutoDetect}
        onChange={handleEditorChange}
      />
      {uploadError ? (
        <p role="alert" style={s.error}>
          {uploadError}
        </p>
      ) : null}
      {autoDetectError ? (
        <p role="alert" style={s.error}>
          {autoDetectError}
        </p>
      ) : null}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  emptyRoot: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  dropzone: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: "100%",
    minHeight: 160,
    padding: "28px 16px",
    border: "1px dashed var(--border-1)",
    borderRadius: 10,
    background: "var(--paper-soft)",
    cursor: "pointer",
    textAlign: "center",
    outline: "none",
    boxSizing: "border-box",
  },
  dropzoneActive: {
    borderColor: "var(--brand-500)",
    background: "color-mix(in srgb, var(--brand-100) 55%, var(--paper-soft))",
  },
  dropzoneDisabled: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
  dropzoneIcon: {
    fontSize: 28,
    color: "var(--ink-400)",
  },
  dropzoneTitle: {
    color: "var(--ink-700)",
    font: "600 14px/20px var(--font-sans)",
  },
  dropzoneHint: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
  titleRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: 10,
  },
  changeImageBtn: {
    flexShrink: 0,
    marginBottom: 1,
  },
  error: {
    margin: 0,
    font: "400 13px/18px var(--font-sans)",
    color: "var(--danger, #c0392b)",
  },
};
