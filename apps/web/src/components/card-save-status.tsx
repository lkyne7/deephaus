"use client";

import type { AutoSaveStatus } from "@/hooks/use-auto-save-card";

type Props = {
  status: AutoSaveStatus;
  error?: string | null;
  onRetry?: () => void;
};

export function CardSaveStatus({ status, error, onRetry }: Props) {
  if (error) {
    return (
      <span style={s.error} title={error} role="alert">
        <i className="ri-error-warning-line" aria-hidden />
        <span style={s.errorText}>{error}</span>
        {onRetry && (
          <button type="button" style={s.retry} onClick={onRetry}>
            Retry save
          </button>
        )}
      </span>
    );
  }

  if (status === "saving" || status === "pending") {
    return (
      <span style={s.muted} role="status">
        <i className="ri-loader-4-line icon-spin" aria-hidden />
        Saving…
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span style={s.saved} role="status">
        <i className="ri-check-line" aria-hidden />
        Saved
      </span>
    );
  }

  return null;
}

const base: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  minWidth: 0,
  font: "400 13px/19px var(--font-sans)",
  color: "var(--fg-quaternary)",
};

const s: Record<string, React.CSSProperties> = {
  muted: base,
  saved: base,
  error: { ...base, color: "var(--danger)" },
  errorText: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  retry: {
    flexShrink: 0,
    padding: 0,
    border: 0,
    background: "none",
    color: "inherit",
    font: "500 13px/19px var(--font-sans)",
    textDecoration: "underline",
    cursor: "pointer",
  },
};
