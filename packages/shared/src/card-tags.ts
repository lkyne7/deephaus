/** Flatten hierarchical tags (e.g. `Topic::Subtopic`) into simple tags without `::`. */
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
      const key = part.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(part);
    }
  }

  return out;
}
