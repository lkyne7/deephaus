"use client";

import { useEffect, useId, useState } from "react";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { renameProject } from "@/lib/projects/rename";

type Props = {
  open: boolean;
  projectId: string;
  currentName: string;
  onClose: () => void;
  onRenamed: (name: string) => void;
};

/**
 * Small modal for renaming a deck. Used from Create (DeckSwitcher) and the
 * deck page header.
 */
export function RenameDeckDialog({
  open,
  projectId,
  currentName,
  onClose,
  onRenamed,
}: Props) {
  const inputId = useId();
  const [value, setValue] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(currentName);
    setError(null);
    setSaving(false);
  }, [open, currentName]);

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter a deck name.");
      return;
    }
    if (trimmed === currentName.trim()) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await renameProject(projectId, trimmed);
      onRenamed(updated.deck_name?.trim() || updated.name);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rename deck.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <AnimatedModal title="Rename deck" onClose={saving ? () => undefined : onClose} maxWidth={420}>
      <div style={s.body}>
        <div className="field">
          <label className="field-label" htmlFor={inputId}>
            Deck name
          </label>
          <input
            id={inputId}
            className="input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submit();
              }
            }}
            maxLength={120}
            autoFocus
            disabled={saving}
          />
        </div>
        {error ? (
          <div style={s.error} role="alert">
            {error}
          </div>
        ) : null}
        <div style={s.footer}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={saving || !value.trim()}
          >
            {saving ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
            Save
          </button>
        </div>
      </div>
    </AnimatedModal>
  );
}

const s: Record<string, React.CSSProperties> = {
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  error: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--grade-again)",
  },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  },
};
