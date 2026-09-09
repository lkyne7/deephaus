import OpenAI from "openai";
import { z } from "zod";
import { normalizeGeneratedTags } from "@deephaus/shared";
import { normalizeClozeText, type LlmConfig } from "./generate.js";

/**
 * Bulk "edit these cards per my instruction" for the Create page card
 * assistant. The model receives a batch of existing cards plus a free-form
 * instruction and returns only the cards it changed; the caller then runs
 * `sanitizeEditedCard` to enforce invariants (type is immutable, cloze cards
 * keep at least one deletion, etc.) before persisting.
 */

export type EditableCardType = "basic" | "cloze" | "image-occlusion";

export interface EditableCard {
  id: string;
  type: EditableCardType;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
}

/** Fields the model may return for a card. All optional/nullable. */
export interface EditedCardPatch {
  id: string;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[] | null;
}

export interface EditCardsInput {
  instruction: string;
  cards: EditableCard[];
  /** Optional deck name for prompt context. */
  deckName?: string | null;
}

export interface EditCardsResult {
  cards: EditedCardPatch[];
  summary: string;
  tokenUsage: number;
}

export const DEFAULT_EDIT_CARDS_MODEL = "gpt-4o-mini";
const EDIT_BATCH_SIZE = 20;
const EDIT_CONCURRENCY = 3;

const editedCardsResponseSchema = z.object({
  summary: z.string(),
  cards: z.array(
    z.object({
      id: z.string(),
      front: z.string().nullable(),
      back: z.string().nullable(),
      cloze_text: z.string().nullable(),
      extra: z.string().nullable(),
      tags: z.array(z.string()).nullable(),
    }),
  ),
});

const EDIT_SYSTEM_PROMPT = [
  "You are an expert flashcard editor inside a spaced-repetition app.",
  "You will receive a list of existing flashcards (as JSON) and a user instruction describing how to change them.",
  "Apply the instruction to every card it applies to. Preserve the facts and meaning of each card unless the instruction explicitly asks to change them.",
  "Never invent facts that are not supported by the card's existing content.",
  "Rules:",
  "- Never change a card's type. Basic cards have `front` and `back`. Cloze cards have `cloze_text` (Anki syntax `{{c1::answer}}`, optional hint `{{c1::answer::hint}}`) and optional `extra`. Image-occlusion cards only allow editing `front` (a title/prompt) and `tags`.",
  "- Cloze cards must keep at least one `{{cN::...}}` deletion. Do not convert cloze cards to question/answer or vice versa.",
  "- Keep any existing HTML/markdown formatting style consistent with the original text.",
  "- Only return cards you actually changed. Return every editable field for each returned card (copy unchanged fields verbatim; use null for fields that do not apply to the card type).",
  "- `tags` is the complete new tag list for that card (not a delta). Return null to leave tags untouched.",
  "- If the instruction does not apply to a card, leave it out.",
  "- `summary`: one short sentence (max 120 characters) describing what you changed, e.g. \"Shortened 5 answers and fixed 2 typos.\"",
  "Respond with JSON only.",
].join("\n");

function buildEditUserPrompt(input: EditCardsInput, batch: EditableCard[]): string {
  return [
    input.deckName ? `Deck: ${input.deckName}` : "",
    `Instruction: ${input.instruction.trim()}`,
    "",
    "Cards:",
    JSON.stringify(
      batch.map((card) => ({
        id: card.id,
        type: card.type,
        front: card.front,
        back: card.back,
        cloze_text: card.cloze_text,
        extra: card.extra,
        tags: card.tags,
      })),
      null,
      0,
    ),
  ]
    .filter(Boolean)
    .join("\n");
}

async function editBatch(
  client: OpenAI,
  model: string,
  input: EditCardsInput,
  batch: EditableCard[],
): Promise<EditCardsResult> {
  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "edited_flashcards",
        strict: true,
        schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            cards: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  front: { type: ["string", "null"] },
                  back: { type: ["string", "null"] },
                  cloze_text: { type: ["string", "null"] },
                  extra: { type: ["string", "null"] },
                  tags: { type: ["array", "null"], items: { type: "string" } },
                },
                required: ["id", "front", "back", "cloze_text", "extra", "tags"],
                additionalProperties: false,
              },
            },
          },
          required: ["summary", "cards"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      { role: "system", content: EDIT_SYSTEM_PROMPT },
      { role: "user", content: buildEditUserPrompt(input, batch) },
    ],
  });

  const tokenUsage = response.usage?.total_tokens ?? 0;
  const content = response.choices[0]?.message?.content;
  if (!content) return { cards: [], summary: "", tokenUsage };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new Error("The assistant returned invalid JSON.");
  }
  const parsed = editedCardsResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("The assistant response did not match the expected card schema.");
  }
  return { cards: parsed.data.cards, summary: parsed.data.summary, tokenUsage };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Ask the model to apply `instruction` to `cards`. Cards are processed in
 * batches (concurrently, bounded) so large selections stay within context
 * limits. Returns raw patches — run `sanitizeEditedCard` before persisting.
 */
export async function editCardsWithInstruction(
  input: EditCardsInput,
  config: LlmConfig,
): Promise<EditCardsResult> {
  if (input.cards.length === 0) return { cards: [], summary: "", tokenUsage: 0 };

  const client = new OpenAI({ apiKey: config.apiKey });
  const model = config.model ?? DEFAULT_EDIT_CARDS_MODEL;

  const batches: EditableCard[][] = [];
  for (let i = 0; i < input.cards.length; i += EDIT_BATCH_SIZE) {
    batches.push(input.cards.slice(i, i + EDIT_BATCH_SIZE));
  }

  const results = await mapWithConcurrency(batches, EDIT_CONCURRENCY, (batch) =>
    editBatch(client, model, input, batch),
  );

  const cards = results.flatMap((r) => r.cards);
  const tokenUsage = results.reduce((sum, r) => sum + r.tokenUsage, 0);
  // Prefer the first non-empty summary; multi-batch runs get a generic one.
  const summary =
    results.length === 1
      ? results[0]!.summary
      : results.find((r) => r.summary.trim())?.summary ?? "";

  return { cards, summary, tokenUsage };
}

/**
 * Offline stand-in used when no OpenAI key is configured: normalizes
 * whitespace and adds an "AI edited" tag so the UI flow can be exercised.
 */
export function createMockEditedCards(input: EditCardsInput): EditCardsResult {
  const collapse = (value: string | null) =>
    value === null ? null : value.replace(/[ \t]{2,}/g, " ").trim();
  const cards: EditedCardPatch[] = input.cards.map((card) => ({
    id: card.id,
    front: collapse(card.front),
    back: collapse(card.back),
    cloze_text: collapse(card.cloze_text),
    extra: collapse(card.extra),
    tags: [...card.tags, "AI edited"],
  }));
  return {
    cards,
    summary: `Placeholder edit (no OpenAI API key): tagged ${cards.length} card${
      cards.length === 1 ? "" : "s"
    } for "${input.instruction.trim().slice(0, 60)}".`,
    tokenUsage: 0,
  };
}

/** Fields that may change on a card as a result of an assistant edit. */
export interface SanitizedCardUpdate {
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
  tags?: string[];
}

const MAX_FIELD_LENGTH = 10_000;

function cleanField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_FIELD_LENGTH ? trimmed.slice(0, MAX_FIELD_LENGTH) : trimmed;
}

function sameText(a: string | null, b: string | null): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tag, i) => tag === b[i]);
}

const MAX_TAGS = 20;

/**
 * Build the new tag list from a model patch. Tags the card already had are
 * kept verbatim (including hierarchical `A::B` tags the user chose), while
 * newly added tags go through `normalizeGeneratedTags` so they stay topical.
 */
function mergeEditedTags(originalTags: string[], patchTags: string[]): string[] {
  const existing = new Set(originalTags.map((tag) => tag.trim()));
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (tag: string) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tag);
  };
  for (const raw of patchTags) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (existing.has(trimmed)) {
      push(trimmed);
      continue;
    }
    for (const tag of normalizeGeneratedTags([trimmed])) push(tag);
  }
  return out.slice(0, MAX_TAGS);
}

/**
 * Validate a model patch against the original card. Returns only the fields
 * that legitimately changed, or `null` when the patch is invalid or a no-op.
 * Card type is immutable, so only fields valid for the original type are kept.
 */
export function sanitizeEditedCard(
  original: EditableCard,
  patch: EditedCardPatch,
): SanitizedCardUpdate | null {
  if (patch.id !== original.id) return null;

  const update: SanitizedCardUpdate = {};

  if (patch.tags !== null && patch.tags !== undefined) {
    const tags = mergeEditedTags(original.tags, patch.tags);
    if (!sameTags(tags, original.tags)) update.tags = tags;
  }

  if (original.type === "basic") {
    const front = cleanField(patch.front);
    const back = cleanField(patch.back);
    // A basic card needs both a prompt and an answer; emptying either is invalid.
    if (patch.front !== null && front === null) return null;
    if (patch.back !== null && back === null && (original.back ?? "").trim()) return null;
    if (front !== null && !sameText(front, original.front)) update.front = front;
    if (back !== null && !sameText(back, original.back)) update.back = back;
  } else if (original.type === "cloze") {
    if (patch.cloze_text !== null) {
      const clozeText = normalizeClozeText(patch.cloze_text ?? "");
      const clozeNumbers = [...clozeText.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]));
      if (!clozeText || clozeNumbers.length === 0 || Math.max(...clozeNumbers) > 9) {
        return null;
      }
      if (!sameText(clozeText, original.cloze_text)) update.cloze_text = clozeText;
    }
    if (patch.extra !== null) {
      // An explicit empty string clears the extra field; null leaves it alone.
      const extra = cleanField(patch.extra);
      if (!sameText(extra, original.extra)) update.extra = extra;
    }
  } else {
    // image-occlusion: only the title/prompt and tags are editable.
    const front = cleanField(patch.front);
    if (front !== null && !sameText(front, original.front)) update.front = front;
  }

  return Object.keys(update).length > 0 ? update : null;
}
