/** "1 learner", "1,820 learners": people who have added a published deck. */
export function learnerLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "learner" : "learners"}`;
}

export function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

const TYPE_NOUNS: Record<string, string> = {
  basic: "front and back",
  cloze: "cloze",
  "image-occlusion": "image",
};

/** "300 front and back · 112 cloze" from cards-per-type counts. */
export function cardMixLabel(types: Record<string, number>): string {
  return ["basic", "cloze", "image-occlusion"]
    .filter((type) => (types[type] ?? 0) > 0)
    .map((type) => `${types[type]!.toLocaleString()} ${TYPE_NOUNS[type]}`)
    .join(" · ");
}

/** Tags an importer adds for bookkeeping, such as "PDF::Page12"; they say nothing about the subject. */
const HOUSEKEEPING_TAG = /^(pdf|page|slide|notes?[ _-]?chunk)\W*\d*$/i;

/**
 * A deck's tags as topics to show: the last part of a nested tag
 * ("Gastrointestinal::Pancreatitis" becomes "Pancreatitis"), without page
 * markers or repeats, most used first.
 */
export function topicLabels(tags: string[], limit = 6): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const tag of tags) {
    const parts = tag.split("::").map((part) => part.trim()).filter(Boolean);
    const label = parts[parts.length - 1];
    if (!label || HOUSEKEEPING_TAG.test(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(label);
    if (topics.length === limit) break;
  }
  return topics;
}
