import OpenAI from "openai";
import { z } from "zod";
import { normalizeClozeText, type LlmConfig } from "./generate.js";
import { MARKDOWN_LATEX_RULES } from "./prompts.js";

/**
 * One-click "regenerate this card".
 * ---------------------------------------------------------------------
 * Produces a fresh version of an existing card that tests the same fact,
 * grounded in the passage the card was generated from (when known). The card
 * type never changes; only its content fields are rewritten. The caller runs
 * `sanitizeRegeneratedCard` before persisting.
 */

export type RegenerableCardType = "basic" | "cloze";

export interface RegenerateCardInput {
  card: {
    type: RegenerableCardType;
    front: string | null;
    back: string | null;
    cloze_text: string | null;
    extra: string | null;
    tags?: string[];
  };
  /** Verbatim evidence quote the card was generated from, if any. */
  sourceQuote?: string | null;
  /** Larger source passage (chunk text) for grounding, if available. */
  sourceContext?: string | null;
  deckName?: string | null;
  /** Whether cloze deletions should carry `::hint` segments. */
  clozeHints?: boolean;
}

export interface RegeneratedCardFields {
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
}

export interface RegenerateCardResult {
  card: RegeneratedCardFields;
  tokenUsage: number;
}

export const DEFAULT_REGENERATE_MODEL = "gpt-4o-mini";
/** Keep the grounding passage bounded so a huge chunk can't blow the prompt. */
const MAX_CONTEXT_CHARS = 6_000;

const responseSchema = z.object({
  front: z.string().nullable(),
  back: z.string().nullable(),
  cloze_text: z.string().nullable(),
  extra: z.string().nullable(),
});

function systemPrompt(type: RegenerableCardType, clozeHints: boolean): string {
  const typeRules =
    type === "cloze"
      ? [
          "- This is a fill-in-the-blank (cloze) card. Return `cloze_text` and optional `extra`; `front` and `back` must be null.",
          "- Use Anki cloze syntax {{c1::hidden term}} with double colons and double closing braces. Hide only the key fact(s); the remaining sentence must give enough context to recall them. Use c1, c2, ... for separate deletions (max 7).",
          clozeHints
            ? "- Add a short 1-3 word hint to every deletion: {{c1::answer::hint}}."
            : "- Do not add hints; use plain {{c1::answer}} syntax.",
          "- `extra` is an optional short explanation shown on reveal. Leave it null if the card does not need one.",
        ]
      : [
          "- This is a basic question/answer card. Return `front` (question) and `back` (answer); `cloze_text` and `extra` must be null.",
          "- The question must be answerable in one direction only, with one clear answer. The answer should be a term, a short phrase or one or two sentences — not a paragraph.",
        ];
  return [
    "You are an expert Anki flashcard author. You will receive an existing flashcard plus (when available) the source passage it was written from.",
    "Write a NEW version of the card that tests the same core fact but is better: clearer, more atomic, unambiguous, and worded differently from the original so the learner cannot rely on surface pattern-matching.",
    "Rules:",
    "- Never change the card type.",
    "- Ground every statement in the source passage when one is given; otherwise stay within the facts of the original card. Do not add facts that appear in neither.",
    "- Do not simply paraphrase word-for-word; restructure the prompt (e.g. ask from the answer's perspective, tighten scope, remove giveaways).",
    ...typeRules,
    MARKDOWN_LATEX_RULES,
    "Respond with JSON only.",
  ].join("\n");
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function buildUserPrompt(input: RegenerateCardInput): string {
  const lines: string[] = [];
  if (input.deckName?.trim()) lines.push(`Deck: ${input.deckName.trim()}`);
  lines.push("Current card:");
  lines.push(
    JSON.stringify(
      {
        type: input.card.type,
        front: input.card.front,
        back: input.card.back,
        cloze_text: input.card.cloze_text,
        extra: input.card.extra,
        tags: input.card.tags ?? [],
      },
      null,
      0,
    ),
  );
  if (input.sourceQuote?.trim()) {
    lines.push("", "Evidence quote the card was generated from:", truncate(input.sourceQuote, 1_500));
  }
  if (input.sourceContext?.trim()) {
    lines.push("", "Source passage:", truncate(input.sourceContext, MAX_CONTEXT_CHARS));
  }
  return lines.join("\n");
}

/** Ask the model for a fresh version of the card. */
export async function regenerateCard(
  input: RegenerateCardInput,
  config: LlmConfig,
): Promise<RegenerateCardResult> {
  const client = new OpenAI({ apiKey: config.apiKey });
  const model = config.model ?? DEFAULT_REGENERATE_MODEL;

  const response = await client.chat.completions.create({
    model,
    temperature: 0.8,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "regenerated_flashcard",
        strict: true,
        schema: {
          type: "object",
          properties: {
            front: { type: ["string", "null"] },
            back: { type: ["string", "null"] },
            cloze_text: { type: ["string", "null"] },
            extra: { type: ["string", "null"] },
          },
          required: ["front", "back", "cloze_text", "extra"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      { role: "system", content: systemPrompt(input.card.type, input.clozeHints ?? false) },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  const tokenUsage = response.usage?.total_tokens ?? 0;
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("The model returned an empty card.");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new Error("The model returned invalid JSON.");
  }
  const parsed = responseSchema.safeParse(parsedJson);
  if (!parsed.success) throw new Error("The model response did not match the expected card schema.");
  return { card: parsed.data, tokenUsage };
}

const MAX_FIELD_LENGTH = 10_000;

function cleanField(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_FIELD_LENGTH ? trimmed.slice(0, MAX_FIELD_LENGTH) : trimmed;
}

/**
 * Validate a regenerated card against the original's type. Returns the fields
 * to persist, or `null` when the result is unusable (missing prompt/answer,
 * cloze without deletions, or identical to the original).
 */
export function sanitizeRegeneratedCard(
  original: RegenerateCardInput["card"],
  patch: RegeneratedCardFields,
): RegeneratedCardFields | null {
  if (original.type === "basic") {
    const front = cleanField(patch.front);
    const back = cleanField(patch.back);
    if (!front || !back) return null;
    const unchanged =
      front === (original.front ?? "").trim() && back === (original.back ?? "").trim();
    if (unchanged) return null;
    return { front, back, cloze_text: null, extra: null };
  }

  const clozeText = normalizeClozeText(patch.cloze_text ?? "");
  const clozeNumbers = [...clozeText.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]));
  if (!clozeText || clozeNumbers.length === 0 || Math.max(...clozeNumbers) > 9) return null;
  const extra = cleanField(patch.extra);
  const unchanged =
    clozeText === (original.cloze_text ?? "").trim() && (extra ?? "") === (original.extra ?? "").trim();
  if (unchanged) return null;
  return { front: null, back: null, cloze_text: clozeText, extra };
}

/**
 * Offline stand-in used when no OpenAI key is configured: lightly rewords the
 * prompt so the UI flow (pulse → replace → undo) can be exercised.
 */
export function createMockRegeneratedCard(input: RegenerateCardInput): RegenerateCardResult {
  const { card } = input;
  if (card.type === "cloze") {
    const text = (card.cloze_text ?? "").trim();
    return {
      card: {
        front: null,
        back: null,
        cloze_text: text ? `Recall: ${text}` : "Recall: {{c1::placeholder}}",
        extra: card.extra,
      },
      tokenUsage: 0,
    };
  }
  const front = (card.front ?? "").trim().replace(/[?.!]+$/, "");
  return {
    card: {
      front: front ? `In your own words: ${front}?` : "In your own words, what is the answer?",
      back: card.back,
      cloze_text: null,
      extra: null,
    },
    tokenUsage: 0,
  };
}
