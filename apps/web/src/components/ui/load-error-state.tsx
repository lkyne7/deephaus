"use client";

type Props = {
  /** What failed to load, e.g. "your decks" — rendered as "Couldn't load {label}". */
  label: string;
  onRetry?: () => void;
  /** Compact variant for small panels (heatmap, side cards). */
  compact?: boolean;
};

/**
 * Replaces the silent-failure pattern where a fetch error left an infinite
 * skeleton or a fake empty state. Always tells the user something went wrong
 * and offers a retry.
 */
export function LoadErrorState({ label, onRetry, compact = false }: Props) {
  return (
    <div style={{ ...s.box, ...(compact ? s.boxCompact : {}) }} role="alert">
      <i
        className="ri-error-warning-line"
        style={{ fontSize: compact ? 22 : 32, color: "var(--orange-500)" }}
        aria-hidden
      />
      <div style={compact ? s.titleCompact : s.title}>Couldn&apos;t load {label}</div>
      {!compact && (
        <div style={s.subtitle}>Check your connection and try again.</div>
      )}
      {onRetry ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  box: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "48px 24px",
    textAlign: "center",
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    height: "100%",
    boxSizing: "border-box",
  },
  boxCompact: {
    padding: "20px 16px",
    gap: 6,
  },
  title: {
    font: "500 15px/22px var(--font-sans)",
    color: "var(--ink-700)",
  },
  titleCompact: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--ink-700)",
  },
  subtitle: {
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
};
