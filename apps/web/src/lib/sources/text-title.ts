/** Shorten at a word boundary so titles never end mid-word or on stray punctuation. */
export function truncateTitle(text: string, max = 60): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const head = space >= max * 0.6 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** First line of pasted text as a title, preferring a whole first sentence. */
export function titleFromText(text: string, max = 60): string {
  const line = text.trim().split(/\n/)[0]?.trim() ?? "";
  const sentence = line.match(/^.{12,}?[.!?](?=\s|$)/)?.[0].replace(/[.!?]+$/, "");
  return sentence && sentence.length <= max ? sentence : truncateTitle(line, max);
}
