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
    <div className={`dh-load-error${compact ? " dh-load-error--compact" : ""}`} role="alert">
      <h2>Couldn&apos;t load {label}</h2>
      {!compact && <p>Check your connection and try again.</p>}
      {onRetry ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
