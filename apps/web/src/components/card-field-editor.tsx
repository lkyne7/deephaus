"use client";

import { cardMediaDisplayUrlSized, cardMediaSnippet, parseCardContent } from "@deephaus/shared";
import { useRef, useState } from "react";
import { InlineCardEditor } from "@/components/rich-text/inline-card-editor";
import "./card-field-editor.css";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  cardId: string;
  placeholder?: string;
  disabled?: boolean;
  allowCloze?: boolean;
};

type FieldImage = { src: string; alt: string };

/**
 * Split a stored field into its editable text and its images. The Tiptap editor
 * has no image node, so images are kept out of the editor and preserved
 * separately — otherwise editing a card would silently drop its images.
 */
function splitField(value: string): { text: string; images: FieldImage[] } {
  const images: FieldImage[] = [];
  let text = "";
  for (const segment of parseCardContent(value ?? "")) {
    if (segment.type === "image") images.push({ src: segment.src, alt: segment.alt });
    else text += segment.value;
  }
  return { text: text.trim(), images };
}

function joinField(text: string, images: FieldImage[]): string {
  let out = text.trim();
  for (const image of images) {
    const alt = image.alt && image.alt !== "Card image" ? image.alt : "image";
    out += cardMediaSnippet(image.src, alt);
  }
  return out.trim();
}

export function CardFieldEditor({
  label,
  value,
  onChange,
  cardId,
  placeholder,
  disabled,
  allowCloze = false,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { text, images } = splitField(value);
  // Latest values for use in async/debounced callbacks (avoids stale closures).
  const stateRef = useRef({ text, images });
  stateRef.current = { text, images };

  async function uploadImage(file: File) {
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
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Upload failed");
      }
      const data = (await res.json()) as { url: string };
      const next = [...stateRef.current.images, { src: data.url, alt: "image" }];
      onChange(joinField(stateRef.current.text, next));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeImage(index: number) {
    const next = stateRef.current.images.filter((_, i) => i !== index);
    onChange(joinField(stateRef.current.text, next));
  }

  return (
    <div style={s.field}>
      <div style={s.labelRow}>
        <label style={s.fieldLabel}>{label}</label>
        <label style={s.uploadBtn}>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            style={{ display: "none" }}
            disabled={disabled || uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadImage(file);
            }}
          />
          <i className="ri-image-add-line" aria-hidden />
          {uploading ? "Uploading…" : "Add image"}
        </label>
      </div>
      <InlineCardEditor
        instanceKey={`${cardId}-${label}-${allowCloze ? "cloze" : "plain"}`}
        value={text}
        onChange={(content) => onChange(joinField(content.markdown, stateRef.current.images))}
        placeholder={placeholder}
        readOnly={disabled || uploading}
        clozeEnabled={allowCloze}
      />
      {images.length > 0 ? (
        <div style={s.imageGrid}>
          {images.map((image, index) => (
            <div key={`${image.src}-${index}`} className="dh-field-image-thumb" tabIndex={0}>
              {/* User-uploaded URLs from our storage bucket. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={cardMediaDisplayUrlSized(image.src, "thumb")}
                alt={image.alt}
                className="dh-field-image-thumb__img"
                loading="lazy"
              />
              {!disabled && (
                <button
                  type="button"
                  className="dh-field-image-thumb__remove"
                  onClick={() => removeImage(index)}
                  aria-label="Remove image"
                  title="Remove image"
                >
                  <i className="ri-close-line" aria-hidden />
                </button>
              )}
            </div>
          ))}
        </div>
      ) : null}
      {uploadError && <div style={s.uploadError}>{uploadError}</div>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  labelRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  fieldLabel: {
    font: "500 12px/16px var(--font-sans)",
    letterSpacing: "0.01em",
    color: "var(--fg-secondary)",
  },
  uploadBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    font: "500 12px/16px var(--font-sans)",
    color: "var(--fg-secondary)",
    cursor: "pointer",
    padding: "4px 8px",
    borderRadius: 8,
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
  },
  uploadError: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--grade-again)",
  },
  imageGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
};
