/** What the Create composer's text turns into when sent. */
export type CreateInputKind = "topic" | "notes" | "youtube" | "website";

/** The shortest topic the generate API accepts. */
export const MIN_TOPIC_CHARS = 3;
/** Text this long, or on several lines, is notes rather than a topic. */
export const NOTES_MIN_CHARS = 200;

const YOUTUBE_URL = /^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtube-nocookie\.com|youtu\.be)\/\S+$/i;
const WEB_URL = /^(https?:\/\/\S+|www\.\S+\.\S+)$/i;

/** Work out what was typed or pasted. Returns null until there is enough to send. */
export function classifyCreateInput(input: string): CreateInputKind | null {
  const text = input.trim();
  if (YOUTUBE_URL.test(text)) return "youtube";
  if (WEB_URL.test(text)) return "website";
  if (text.length >= NOTES_MIN_CHARS || text.includes("\n")) return "notes";
  return text.length >= MIN_TOPIC_CHARS ? "topic" : null;
}

/**
 * Says what the composer will do with a link or notes, so a wrong guess is
 * visible. A plain topic needs no explanation, so it gets no label.
 */
export function createInputLabel(kind: CreateInputKind): string | null {
  switch (kind) {
    case "youtube":
      return "YouTube video, using its transcript";
    case "website":
      return "Website, using the page text";
    case "notes":
      return "Notes, as a source";
    case "topic":
      return null;
  }
}

/** `http` is optional in the composer but required by the import APIs. */
export function normalizeUrl(input: string): string {
  const url = input.trim();
  // Keyboards capitalise the start of a field, which turns the scheme into "Https".
  const scheme = url.match(/^https?:\/\//i)?.[0];
  return scheme ? `${scheme.toLowerCase()}${url.slice(scheme.length)}` : `https://${url}`;
}

/** Shorten at a word boundary, so titles never end mid-word. Mirrors web's helper. */
export function truncateTitle(text: string, max = 48): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const head = space >= max * 0.6 ? cut.slice(0, space) : cut;
  return `${head.replace(/[\s.,;:!?-]+$/, "")}…`;
}

function hostOf(url: string): string {
  const host = normalizeUrl(url).replace(/^https?:\/\//i, "").split(/[/?#]/)[0] ?? "";
  return host.replace(/^www\./i, "");
}

/** The name a new deck takes from its source, so nobody has to name it first. */
export function deckTitleFromInput(kind: CreateInputKind, input: string): string {
  const text = input.trim();
  if (kind === "youtube") return "YouTube video";
  if (kind === "website") return hostOf(text) || "Website";
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  const title = truncateTitle(firstLine);
  return kind === "topic" ? title.charAt(0).toUpperCase() + title.slice(1) : title;
}

/** A file's name without its extension or path, for the same purpose. */
export function deckTitleFromFile(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, "");
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[_-]+/g, " ");
  return truncateTitle(stem) || "New deck";
}
