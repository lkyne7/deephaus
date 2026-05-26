"use client";

import type { AutoSaveStatus } from "@/hooks/use-auto-save-card";

type Props = {
  status: AutoSaveStatus;
  error?: string | null;
};

export function CardSaveStatus({ status, error }: Props) {
  if (error) {
    return (
      <span style={s.error} title={error}>
        <i className="ri-error-warning-line" aria-hidden />
        Save failed
      </span>
    );
  }

  if (status === "saving" || status === "pending") {
    return (
      <span style={s.muted}>
        <i className="ri-loader-4-line icon-spin" aria-hidden />
        Saving…
      </span>
    );
  }

  if (status === "saved") {
    return (
      <span style={s.saved}>
        <i className="ri-check-line" aria-hidden />
        Saved
      </span>
    );
  }

  return null;
}

const s: Record<string, React.CSSProperties> = {
  muted: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  saved: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--teal-700)",
  },
  error: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--grade-again)",
  },
};
