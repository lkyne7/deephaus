export const MAX_CLOZE_ID = 9;

export const CLOZE_IDS = Array.from(
  { length: MAX_CLOZE_ID },
  (_, index) => `c${index + 1}`,
) as readonly string[];

export type TextSelection = {
  start: number;
  end: number;
};

export type ClozeMatch = {
  start: number;
  end: number;
  id: string;
  text: string;
  hint: string | null;
  raw: string;
};

const CLOZE_REGEX = /\{\{c(\d+)::([\s\S]+?)(?:::([\s\S]+?))?\}\}/g;

export function clozeToMarkdown(text: string, id: string, hint?: string | null): string {
  if (hint) return `{{${id}::${text}::${hint}}}`;
  return `{{${id}::${text}}}`;
}

export function findClozeMatches(text: string): ClozeMatch[] {
  const matches: ClozeMatch[] = [];
  for (const match of text.matchAll(CLOZE_REGEX)) {
    const start = match.index ?? 0;
    matches.push({
      start,
      end: start + match[0].length,
      id: `c${match[1]}`,
      text: match[2] ?? "",
      hint: match[3] ?? null,
      raw: match[0],
    });
  }
  return matches;
}

export function findClozeForSelection(
  text: string,
  selection: TextSelection,
): ClozeMatch | null {
  const anchor = selection.start;
  const focus = selection.end;
  const from = Math.min(anchor, focus);
  const to = Math.max(anchor, focus);
  return (
    findClozeMatches(text).find((match) => from >= match.start && to <= match.end) ?? null
  );
}

export function nextClozeIdFromText(text: string): string {
  let max = 0;
  for (const match of text.matchAll(CLOZE_REGEX)) {
    const n = Number.parseInt(match[1] ?? "0", 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `c${Math.min(max + 1, MAX_CLOZE_ID)}`;
}

export function replaceRange(
  text: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

export function wrapSelection(
  text: string,
  selection: TextSelection,
  before: string,
  after: string,
): { text: string; selection: TextSelection } {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  if (start === end) {
    const inserted = `${before}${after}`;
    const nextText = replaceRange(text, start, end, inserted);
    const cursor = start + before.length;
    return { text: nextText, selection: { start: cursor, end: cursor } };
  }

  const selected = text.slice(start, end);
  if (selected.startsWith(before) && selected.endsWith(after) && selected.length >= before.length + after.length) {
    const inner = selected.slice(before.length, selected.length - after.length);
    const nextText = replaceRange(text, start, end, inner);
    return { text: nextText, selection: { start, end: start + inner.length } };
  }

  const wrapped = `${before}${selected}${after}`;
  const nextText = replaceRange(text, start, end, wrapped);
  return {
    text: nextText,
    selection: { start: start + before.length, end: end + before.length },
  };
}

export function wrapSelectedLines(
  text: string,
  selection: TextSelection,
  prefix: string,
): { text: string; selection: TextSelection } {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  const lineStart = text.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIdx = text.indexOf("\n", end);
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const allPrefixed = lines.every((line) => line.startsWith(prefix));
  const nextLines = allPrefixed
    ? lines.map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line))
    : lines.map((line) => (line.length === 0 ? prefix.trimEnd() : `${prefix}${line}`));
  const nextBlock = nextLines.join("\n");
  const nextText = replaceRange(text, lineStart, lineEnd, nextBlock);
  return {
    text: nextText,
    selection: { start: lineStart, end: lineStart + nextBlock.length },
  };
}

export function addClozeSelection(
  text: string,
  selection: TextSelection,
  id?: string,
): { text: string; selection: TextSelection } {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  if (start === end) return { text, selection };
  const selected = text.slice(start, end);
  const clozeId = id ?? nextClozeIdFromText(text);
  const wrapped = clozeToMarkdown(selected, clozeId);
  const nextText = replaceRange(text, start, end, wrapped);
  return {
    text: nextText,
    selection: { start, end: start + wrapped.length },
  };
}

export function updateClozeMatch(
  text: string,
  match: ClozeMatch,
  updates: { id?: string; hint?: string | null; text?: string },
): string {
  const nextId = updates.id ?? match.id;
  const nextText = updates.text ?? match.text;
  const nextHint = updates.hint !== undefined ? updates.hint : match.hint;
  const replacement = clozeToMarkdown(nextText, nextId, nextHint);
  return replaceRange(text, match.start, match.end, replacement);
}

export function removeClozeMatch(text: string, match: ClozeMatch): string {
  return replaceRange(text, match.start, match.end, match.text);
}

export function insertLatexInline(
  text: string,
  selection: TextSelection,
): { text: string; selection: TextSelection } {
  return wrapSelection(text, selection, "$", "$");
}

export function insertLatexBlock(
  text: string,
  selection: TextSelection,
): { text: string; selection: TextSelection } {
  const start = Math.min(selection.start, selection.end);
  const end = Math.max(selection.start, selection.end);
  const selected = start === end ? "E = mc^2" : text.slice(start, end);
  const block = `\n$$\n${selected}\n$$\n`;
  const nextText = replaceRange(text, start, end, block);
  return {
    text: nextText,
    selection: { start: start + block.length, end: start + block.length },
  };
}

export type CardType = "basic" | "cloze";

export type CardUpdateFields = {
  type: CardType;
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
  tags?: string[];
};

export function buildCardUpdateBody(fields: CardUpdateFields): Record<string, unknown> {
  const body: Record<string, unknown> = {
    front: fields.front ?? null,
    back:
      fields.type === "basic"
        ? fields.back ?? fields.extra ?? null
        : fields.back ?? null,
    cloze_text: fields.cloze_text ?? null,
    extra: fields.type === "basic" ? null : fields.extra ?? null,
  };
  if (fields.tags !== undefined) {
    body.tags = fields.tags;
  }
  return body;
}

export function cardUpdateSnapshot(fields: CardUpdateFields): string {
  return JSON.stringify(buildCardUpdateBody(fields));
}

export function parseTagsInput(raw: string): string[] {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}
