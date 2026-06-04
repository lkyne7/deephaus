const CLOZE_MARKUP_RE = /\{\{c\d+::([\s\S]+?)(?:::[\s\S]+?)?\}\}/g;

/** Replace cloze spans with their inner text (images/markdown outside clozes are kept). */
export function stripClozeMarkup(text: string | null | undefined): string {
  if (!text?.trim()) return "";
  return text.replace(CLOZE_MARKUP_RE, "$1").trim();
}

/** Placeholder shown in review when a cloze deletion is hidden (Anki-style brackets). */
export function clozeHintPlaceholder(hint: string | null | undefined): string {
  const trimmed = hint?.trim();
  if (!trimmed) return "[...]";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed;
  return `[${trimmed}]`;
}
