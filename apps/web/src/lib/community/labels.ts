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
