/**
 * Shapes and helpers for the study window's Hint and Explain, shared by the
 * web API, the api-client, the local (offline) reader and both apps.
 */

export type CardExplainKind = "explain" | "hint";

/** Card fields the tutor reads, and that decide whether a saved result is stale. */
export interface CardExplainContent {
  type: "basic" | "cloze" | "image-occlusion";
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
  source_quote?: string | null;
}

/** A field change the tutor suggests for the card being studied. */
export interface CardFieldFix {
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
}

export interface CardExplanationBody {
  gist: string;
  why: string[];
  /** A card from the same deck worth telling apart from this one. */
  confusable: { card_id: string; note: string } | null;
  hook: string | null;
  /** Set when the tutor thinks the card itself is wrong or unclear. */
  card_issue: { problem: string; fix: CardFieldFix } | null;
}

export type ExplainSuggestion =
  | { kind: "fix"; fix: CardFieldFix; applied?: boolean }
  | { kind: "new_card"; front: string; back: string; added?: boolean };

export interface ExplainThreadMessage {
  role: "user" | "assistant";
  text: string;
  suggestion?: ExplainSuggestion | null;
  created_at: string;
}

/** What GET/POST /api/cards/[id]/explain return, and the offline reader too. */
export interface CardExplainState {
  card_id: string;
  /** Null until written. Omitted from hint responses. */
  explanation: CardExplanationBody | null;
  /** Hints for the requested cloze ordinal ("0" for basic cards). */
  hints: string[];
  thread: ExplainThreadMessage[];
  /** The card changed since this was written. */
  stale: boolean;
  source: { id: string | null; title: string | null; quote: string | null } | null;
  confusable: {
    id: string;
    type: CardExplainContent["type"];
    front: string | null;
    back: string | null;
    cloze_text: string | null;
    extra: string | null;
  } | null;
  updated_at: string | null;
}

export const EXPLAIN_THREAD_LIMIT = 12;
export const EXPLAIN_HINT_COUNT = 3;

function normalizeField(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Change detector for a card's text (not a security hash). Pure JS so the phone
 * and the offline web reader compute exactly what the server stored.
 */
export function cardContentHash(card: CardExplainContent): string {
  const text = [
    card.type,
    normalizeField(card.front),
    normalizeField(card.back),
    normalizeField(card.cloze_text),
    normalizeField(card.extra),
    normalizeField(card.source_quote),
  ].join("␟");
  // cyrb53: 53-bit string hash with good spread, no dependencies.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const value = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `v1:${value.toString(16)}`;
}

/** Hints are stored per cloze ordinal; basic and occlusion cards use "0". */
export function hintKey(clozeOrd: number | null | undefined): string {
  return String(Number.isInteger(clozeOrd) && (clozeOrd as number) > 0 ? clozeOrd : 0);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/** A stored `card_explanations` row as either Postgres (jsonb) or SQLite (text) returns it. */
export interface CardExplanationRow {
  card_id: string;
  content_hash: string;
  explanation: unknown;
  hints: unknown;
  thread: unknown;
  updated_at: string | null;
}

export interface CardExplainContext {
  card: CardExplainContent & { id: string };
  source: { id: string | null; title: string | null } | null;
  /** Looks up the confusable card the explanation names, if it still exists. */
  findCard?: (id: string) => CardExplainState["confusable"];
}

/** Builds the response shape from a saved row (or none) and the current card. */
export function buildCardExplainState(
  row: CardExplanationRow | null,
  context: CardExplainContext,
  options: { kind: CardExplainKind; clozeOrd?: number | null },
): CardExplainState {
  const explanation = parseJson<CardExplanationBody | null>(row?.explanation, null);
  const hints = parseJson<Record<string, string[]>>(row?.hints, {});
  const thread = parseJson<ExplainThreadMessage[]>(row?.thread, []);
  const includeExplanation = options.kind === "explain";
  const confusableId = includeExplanation ? explanation?.confusable?.card_id : null;
  return {
    card_id: context.card.id,
    explanation: includeExplanation ? explanation : null,
    hints: Array.isArray(hints[hintKey(options.clozeOrd)]) ? hints[hintKey(options.clozeOrd)] : [],
    thread: includeExplanation && Array.isArray(thread) ? thread : [],
    stale: row ? row.content_hash !== cardContentHash(context.card) : false,
    source: includeExplanation
      ? {
          id: context.source?.id ?? null,
          title: context.source?.title ?? null,
          quote: context.card.source_quote?.trim() || null,
        }
      : null,
    confusable: confusableId && context.findCard ? context.findCard(confusableId) : null,
    updated_at: row?.updated_at ?? null,
  };
}
