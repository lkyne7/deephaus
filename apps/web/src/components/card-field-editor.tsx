"use client";

import { cardMediaSnippet } from "@deephaus/shared";
import { useRef, useState } from "react";
import { InlineCardEditor } from "@/components/rich-text/inline-card-editor";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  cardId: string;
  placeholder?: string;
  disabled?: boolean;
  allowCloze?: boolean;
};

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
      onChange(`${value}${cardMediaSnippet(data.url)}`);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
        instanceKey={`${cardId}-${label}`}
        value={value}
        onChange={(content) => onChange(content.markdown)}
        placeholder={placeholder}
        readOnly={disabled || uploading}
        clozeEnabled={allowCloze}
      />
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
    font: "500 11px/1 var(--font-sans)",
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--fg-4)",
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
};
