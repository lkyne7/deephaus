const CLOZE_MARKUP_RE = /\{\{c\d+::([\s\S]+?)(?:::[\s\S]+?)?\}\}/g;

/** Replace cloze spans with their inner text (images/markdown outside clozes are kept). */
export function stripClozeMarkup(text: string | null | undefined): string {
  if (!text?.trim()) return "";
  return text.replace(CLOZE_MARKUP_RE, "$1").trim();
}

/** Remove the optional ::hint from cloze deletions, keeping `{{cN::answer}}`. */
export function stripClozeHints(text: string | null | undefined): string {
  if (!text) return "";
  // Capture the deletion's full inner content without crossing the closing `}}`
  // (so adjacent deletions are never merged), then drop everything from the
  // first `::` onward — matching how the renderer splits answer vs. hint.
  return text.replace(
    /\{\{(c\d+)::((?:(?!\}\})[\s\S])*?)\}\}/g,
    (match, id: string, content: string) => {
      const sep = content.indexOf("::");
      return sep === -1 ? match : `{{${id}::${content.slice(0, sep)}}}`;
    },
  );
}

/** Add a default hint to any cloze deletion missing the `::hint` segment. */
export function ensureClozeHints(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(
    /\{\{(c\d+)::((?:(?!\}\})[\s\S])*?)\}\}/g,
    (match, id: string, content: string) => {
      if (content.includes("::")) return match;
      return `{{${id}::${content}::...}}`;
    },
  );
}

/** Placeholder shown in review when a cloze deletion is hidden (Anki-style brackets). */
export function clozeHintPlaceholder(hint: string | null | undefined): string {
  const trimmed = hint?.trim();
  if (!trimmed) return "[...]";
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed;
  return `[${trimmed}]`;
}
