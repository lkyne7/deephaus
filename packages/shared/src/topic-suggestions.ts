import { topicQueryFromSource } from "./topic-presets.js";

export type TopicSuggestion = {
  id: string;
  label: string;
  query: string;
};

export type TopicSuggestionDeck = {
  name: string;
  updatedAt: string;
  origin: "community" | "imported" | "generated";
};

const MAX_SUGGESTIONS = 5;

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function slugId(prefix: string, text: string): string {
  const slug = normalizeKey(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${prefix}-${slug || "item"}`;
}

function chipLabel(text: string, max = 42): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Build 3–5 topic chips from prior topic runs and the user's decks. */
export function buildTopicSuggestions(input: {
  topicQueries: string[];
  decks: TopicSuggestionDeck[];
}): TopicSuggestion[] {
  const seen = new Set<string>();
  const out: TopicSuggestion[] = [];

  const add = (label: string, query: string, prefix: string) => {
    if (out.length >= MAX_SUGGESTIONS) return;
    const trimmed = query.trim();
    const key = normalizeKey(trimmed);
    if (key.length < 3 || seen.has(key)) return;
    seen.add(key);
    out.push({
      id: slugId(prefix, trimmed),
      label: chipLabel(label),
      query: trimmed,
    });
  };

  for (const query of input.topicQueries) {
    add(query, query, "topic");
  }

  const byOrigin = (origin: TopicSuggestionDeck["origin"]) =>
    [...input.decks]
      .filter((d) => d.origin === origin)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  for (const deck of byOrigin("community")) {
    add(deck.name, deck.name, "community");
  }
  for (const deck of byOrigin("imported")) {
    add(deck.name, deck.name, "imported");
  }
  for (const deck of byOrigin("generated")) {
    add(deck.name, deck.name, "generated");
  }

  return out;
}

/** Extract a topic string from a source row (topic type or legacy prefix). */
export function topicQueryFromSourceRow(source: {
  type: string;
  raw_text?: string | null;
}): string | null {
  const q = topicQueryFromSource(source).trim();
  return q || null;
}
