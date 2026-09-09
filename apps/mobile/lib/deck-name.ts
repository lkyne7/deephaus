export type FormattedDeckName = {
  /** Leaf name, cleaned of underscores. */
  title: string;
  /** Parent path ("EKG › Chapter 4"), or null when the deck isn't nested. */
  path: string | null;
};

/**
 * Anki imports keep their raw "Parent::Child::Leaf" names with underscores
 * for spaces. Split the hierarchy and clean the segments for display.
 */
export function formatDeckName(raw: string): FormattedDeckName {
  const cleaned = raw.replace(/_/g, " ").trim();
  const segments = cleaned
    .split("::")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length <= 1) {
    return { title: cleaned || raw, path: null };
  }
  return {
    title: segments[segments.length - 1],
    path: segments.slice(0, -1).join(" › "),
  };
}

/** Single-line variant for pickers and titles: "EKG › Chapter 4 › Leaf". */
export function deckDisplayName(raw: string): string {
  const { title, path } = formatDeckName(raw);
  return path ? `${path} › ${title}` : title;
}
