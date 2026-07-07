/**
 * Location/source-reference style labels that describe *where* a card came from
 * rather than *what* it is about (e.g. "Page 12", "Slide 3", "Figure 2").
 * Auto-tags should be topical (e.g. "Cardiology"), so these are filtered out.
 */
const SOURCE_LOCATION_TAG_PATTERNS: RegExp[] = [
  // "Page 1", "Page12", "pg. 3", "p 5", "slide 2", "figure 4", "section 8",
  // "chapter 5", "unit 3", "lecture 7", "lesson 2", "module 1", "part 4", "table 2".
  /^(pages?|pgs?|p|slides?|figs?|figures?|sections?|secs?|chapters?|chaps?|ch|units?|lectures?|lessons?|modules?|parts?|tables?|appendix|exhibits?)\s*\.?\s*[-#]?\s*\d+[a-z]?$/i,
  // Bare numbers ("1", "42").
  /^\d+$/,
  // Timestamps ("00:12", "1:02:33").
  /^\d{1,2}:\d{2}(:\d{2})?$/,
];

/** True when a tag looks like a source/location reference rather than a topic. */
export function isSourceLocationTag(tag: string): boolean {
  const trimmed = tag.trim();
  if (!trimmed) return false;
  return SOURCE_LOCATION_TAG_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Flatten hierarchical tags (e.g. `Topic::Subtopic`) into simple tags without
 * `::`, and drop source/location references so auto-tags stay topical.
 */
export function normalizeGeneratedTags(tags: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of tags ?? []) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    const parts = trimmed
      .split("::")
      .map((part) => part.trim())
      .filter(Boolean);

    for (const part of parts) {
      if (isSourceLocationTag(part)) continue;
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
  }

  return out;
}
