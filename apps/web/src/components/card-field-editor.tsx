"use client";

import { useCallback } from "react";
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
  const uploadImage = useCallback(
    async (file: File) => {
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
      const data = (await res.json()) as { url: string };
      return data.url;
    },
    [cardId],
  );

  return (
    <div style={s.field}>
      <label style={s.fieldLabel}>{label}</label>
      <InlineCardEditor
        instanceKey={`${cardId}-${label}-${allowCloze ? "cloze" : "plain"}`}
        value={value ?? ""}
        onChange={(content) => onChange(content.markdown)}
        placeholder={placeholder}
        readOnly={disabled}
        clozeEnabled={allowCloze}
        uploadImage={disabled ? undefined : uploadImage}
      />
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  fieldLabel: {
    font: "500 12px/16px var(--font-sans)",
    letterSpacing: "0.01em",
    color: "var(--fg-secondary)",
  },
};
