"use client";

import { useEffect, useState, type KeyboardEvent } from "react";

export function parseTagsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
};

function CardTagsEditorField({
  value,
  onChange,
  disabled = false,
  label = "Tags",
}: Props) {
  const safeValue = value ?? "";
  const tags = uniqueTags(parseTagsInput(safeValue));
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setDraft("");
  }, [safeValue]);

  function commitTags(nextTags: string[]) {
    onChange(uniqueTags(nextTags).join(", "));
    setDraft("");
  }

  function removeTag(tag: string) {
    commitTags(tags.filter((t) => t !== tag));
  }

  function addFromDraft(raw: string) {
    const incoming = raw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (incoming.length === 0) return;
    commitTags([...tags, ...incoming]);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addFromDraft(draft);
      return;
    }
    if (e.key === "Backspace" && draft === "" && tags.length > 0) {
      removeTag(tags[tags.length - 1]!);
    }
  }

  return (
    <div style={s.field}>
      <label style={s.fieldLabel}>{label}</label>
      <div className="card-tags-field" data-disabled={disabled ? "" : undefined}>
        {tags.map((tag) => (
          <span key={tag} className="study-tag-pill card-tags-pill">
            <span className="card-tags-pill-text">{tag}</span>
            {!disabled ? (
              <button
                type="button"
                className="card-tags-pill-remove"
                onClick={() => removeTag(tag)}
                aria-label={`Remove tag ${tag}`}
              >
                <i className="ri-close-line" aria-hidden />
              </button>
            ) : null}
          </span>
        ))}
        <input
          className="card-tags-input"
          value={draft ?? ""}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (draft.trim()) addFromDraft(draft);
          }}
          placeholder={tags.length === 0 ? "Add tags…" : ""}
          disabled={disabled}
          aria-label="Add tags"
        />
      </div>
    </div>
  );
}

export function CardTagsEditor(props: Props) {
  return <CardTagsEditorField {...props} value={props.value ?? ""} />;
}

const s: Record<string, React.CSSProperties> = {
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  fieldLabel: {
    font: "500 13px/16px var(--font-sans)",
    color: "var(--fg-secondary)",
  },
};
