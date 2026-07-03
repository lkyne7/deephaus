import OpenAI from "openai";
import {
  deduplicateCards,
  generatedCardsResponseSchema,
  normalizeGeneratedTags,
  parseGenerationSettings,
  stripClozeHints,
  ensureClozeHints,
  type CardMix,
  type GeneratedCard,
  type GenerationSettings,
  type TextChunk,
  MAX_CARDS_PER_JOB,
} from "@deephaus/shared";
import { buildSystemPrompt, buildUserPrompt, buildTopicSystemPrompt, buildTopicUserPrompt } from "./prompts.js";

export interface LlmConfig {
  apiKey: string;
  model?: string;
}

/**
 * Default model for card generation. A reasoning-class "mini" model follows the
 * nuanced cloze-hint instructions (hint only deletions that benefit) far more
 * reliably than gpt-4o-mini, which tended to hint everything or nothing.
 */
export const DEFAULT_GENERATION_MODEL = "gpt-5.4-mini";

export interface GenerateFromChunksResult {
  cards: GeneratedCard[];
  tokenUsage: number;
  detail?: string;
}

/** Fix common model mistakes in Anki cloze syntax before validation. */
export function normalizeClozeText(raw: string): string {
  let text = raw.trim();
  // Single-colon typo: {{c1:term}} → {{c1::term}}
  text = text.replace(/\{\{c(\d+):(?![:\s])/gi, "{{c$1::");
  // Missing closing braces on simple deletions
  text = text.replace(/\{\{c(\d+)::([^}]+)\}(?!\})/g, "{{c$1::$2}}");
  return text;
}

/** Keep evidence quotes verbatim (only trim edges) so they match the source. */
function sanitizeSourceQuote(raw: string | null | undefined): string | undefined {
  const quote = raw?.trim();
  if (!quote) return undefined;
  return quote.length > 600 ? quote.slice(0, 600) : quote;
}

function sanitizeCard(
  card: GeneratedCard,
  requestedTypes: CardMix[],
  clozeHints: boolean,
): GeneratedCard | null {
  if (card.type !== "basic" && card.type !== "cloze") return null;
  if (!requestedTypes.includes(card.type)) return null;

  const sourceQuote = sanitizeSourceQuote(card.sourceQuote);

  if (card.type === "basic") {
    if (!card.front?.trim() || !card.back?.trim()) return null;
    return {
      type: "basic",
      front: card.front.trim(),
      back: card.back.trim(),
      sourceQuote,
      tags: normalizeGeneratedTags(card.tags),
    };
  }

  let clozeText = normalizeClozeText(card.clozeText ?? "");
  clozeText = clozeHints ? ensureClozeHints(clozeText) : stripClozeHints(clozeText);
  if (!clozeText) return null;
  const clozeNumbers = [...clozeText.matchAll(/\{\{c(\d+)::/g)].map((m) =>
    Number(m[1]),
  );
  if (clozeNumbers.length === 0 || Math.max(...clozeNumbers) > 9) return null;

  return {
    type: "cloze",
    clozeText,
    extra: card.extra?.trim() || undefined,
    sourceQuote,
    tags: normalizeGeneratedTags(card.tags),
  };
}

export interface GenerateChunkOptions {
  /** Restrict this call to a single card type (used for guaranteed multi-type mixes). */
  forceType?: CardMix;
  /** Scale the target card count for this call (e.g. when splitting across types). */
  cardCountScale?: number;
}

export async function generateCardsFromChunk(
  chunk: TextChunk,
  settings: GenerationSettings,
  config: LlmConfig,
  opts: GenerateChunkOptions = {},
): Promise<{ cards: GeneratedCard[]; tokenUsage: number; rejected: number; apiError?: string }> {
  const client = new OpenAI({ apiKey: config.apiKey });
  const model = config.model ?? DEFAULT_GENERATION_MODEL;
  const normalized = parseGenerationSettings(settings);
  const requestedTypes = opts.forceType ? [opts.forceType] : normalized.cardTypes;
  const clozeHints = normalized.clozeHints;

  let response;
  try {
    response = await client.chat.completions.create({
      model,
      temperature: 0.3,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "flashcards",
          strict: true,
          schema: {
            type: "object",
            properties: {
              cards: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["basic", "cloze"] },
                    front: { type: ["string", "null"] },
                    back: { type: ["string", "null"] },
                    clozeText: { type: ["string", "null"] },
                    extra: { type: ["string", "null"] },
                    sourceQuote: { type: ["string", "null"] },
                    tags: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["type", "front", "back", "clozeText", "extra", "sourceQuote", "tags"],
                  additionalProperties: false,
                },
              },
            },
            required: ["cards"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(settings, {
            forceType: opts.forceType,
            cardCountScale: opts.cardCountScale,
          }),
        },
        {
          role: "user",
          content: buildUserPrompt(chunk, { autoTags: normalized.autoTags }),
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI request failed";
    return { cards: [], tokenUsage: 0, rejected: 0, apiError: message };
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return { cards: [], tokenUsage: response.usage?.total_tokens ?? 0, rejected: 0 };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    return {
      cards: [],
      tokenUsage: response.usage?.total_tokens ?? 0,
      rejected: 0,
      apiError: "Model returned invalid JSON.",
    };
  }

  const parsed = generatedCardsResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      cards: [],
      tokenUsage: response.usage?.total_tokens ?? 0,
      rejected: 0,
      apiError: "Model response did not match the expected card schema.",
    };
  }

  const rawCount = parsed.data.cards.length;
  const cards = parsed.data.cards
    .map((card) => sanitizeCard(card, requestedTypes, clozeHints))
    .filter((c): c is GeneratedCard => c !== null)
    // Attach provenance so the processor can link each card to its source chunk.
    .map((card) => ({ ...card, sourceRef: chunk.sourceRef, chunkIndex: chunk.index }));

  return {
    cards,
    tokenUsage: response.usage?.total_tokens ?? 0,
    rejected: rawCount - cards.length,
  };
}

export async function generateCardsFromChunks(
  chunks: TextChunk[],
  settings: GenerationSettings,
  config: LlmConfig,
  onProgress?: (completed: number, total: number) => void,
): Promise<GenerateFromChunksResult> {
  const allCards: GeneratedCard[] = [];
  let tokenUsage = 0;
  let totalRejected = 0;
  let wrongTypeCount = 0;
  const apiErrors: string[] = [];

  const requestedTypes = parseGenerationSettings(settings).cardTypes;
  const requestedLabel = requestedTypes.join(" / ");

  // When the user asks for more than one text card type, models (especially
  // smaller ones) tend to collapse to a single type if left to "choose a mix".
  // To honor the selection we run one constrained pass per type and split the
  // per-1k card budget across them so the total still tracks the detail level.
  const multiType = requestedTypes.length > 1;
  const passes: GenerateChunkOptions[] = multiType
    ? requestedTypes.map((forceType) => ({
        forceType,
        cardCountScale: 1 / requestedTypes.length,
      }))
    : [{}];

  outer: for (let i = 0; i < chunks.length; i += 1) {
    for (const pass of passes) {
      const { cards, tokenUsage: chunkTokens, rejected, apiError } =
        await generateCardsFromChunk(chunks[i], settings, config, pass);
      if (apiError) apiErrors.push(apiError);
      wrongTypeCount += rejected;
      allCards.push(...cards);
      tokenUsage += chunkTokens;

      if (allCards.length >= MAX_CARDS_PER_JOB) {
        onProgress?.(i + 1, chunks.length);
        break outer;
      }
    }
    onProgress?.(i + 1, chunks.length);
  }

  const deduped = deduplicateCards(allCards).slice(0, MAX_CARDS_PER_JOB);

  if (deduped.length > 0) {
    return { cards: deduped, tokenUsage };
  }

  const detailParts: string[] = [];
  if (apiErrors.length > 0) {
    detailParts.push(apiErrors[0]!);
  } else if (wrongTypeCount > 0) {
    detailParts.push(
      `The model returned ${wrongTypeCount} card(s) that were the wrong type or invalid for ${requestedLabel}.`,
    );
  } else if (chunks.length > 0) {
    detailParts.push("Try a different card type or detail level.");
  }

  return {
    cards: [],
    tokenUsage,
    detail: detailParts.length > 0 ? detailParts.join(" ") : undefined,
  };
}

async function generateTopicPass(
  topic: string,
  settings: GenerationSettings,
  config: LlmConfig,
  opts: GenerateChunkOptions,
): Promise<{ cards: GeneratedCard[]; tokenUsage: number; rejected: number; apiError?: string }> {
  const client = new OpenAI({ apiKey: config.apiKey });
  const model = config.model ?? DEFAULT_GENERATION_MODEL;
  const normalized = parseGenerationSettings(settings);
  const requestedTypes = opts.forceType ? [opts.forceType] : normalized.cardTypes;
  const clozeHints = normalized.clozeHints;

  let response;
  try {
    response = await client.chat.completions.create({
      model,
      temperature: 0.4,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "flashcards",
          strict: true,
          schema: {
            type: "object",
            properties: {
              cards: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["basic", "cloze"] },
                    front: { type: ["string", "null"] },
                    back: { type: ["string", "null"] },
                    clozeText: { type: ["string", "null"] },
                    extra: { type: ["string", "null"] },
                    sourceQuote: { type: ["string", "null"] },
                    tags: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["type", "front", "back", "clozeText", "extra", "sourceQuote", "tags"],
                  additionalProperties: false,
                },
              },
            },
            required: ["cards"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content: buildTopicSystemPrompt(settings, {
            forceType: opts.forceType,
            cardCountScale: opts.cardCountScale,
          }),
        },
        {
          role: "user",
          content: buildTopicUserPrompt(topic, { autoTags: normalized.autoTags }),
        },
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAI request failed";
    return { cards: [], tokenUsage: 0, rejected: 0, apiError: message };
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return { cards: [], tokenUsage: response.usage?.total_tokens ?? 0, rejected: 0 };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    return {
      cards: [],
      tokenUsage: response.usage?.total_tokens ?? 0,
      rejected: 0,
      apiError: "Model returned invalid JSON.",
    };
  }

  const parsed = generatedCardsResponseSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      cards: [],
      tokenUsage: response.usage?.total_tokens ?? 0,
      rejected: 0,
      apiError: "Model response did not match the expected card schema.",
    };
  }

  const rawCount = parsed.data.cards.length;
  const cards = parsed.data.cards
    .map((card) => sanitizeCard(card, requestedTypes, clozeHints))
    .filter((c): c is GeneratedCard => c !== null);

  return {
    cards,
    tokenUsage: response.usage?.total_tokens ?? 0,
    rejected: rawCount - cards.length,
  };
}

export async function generateCardsFromTopic(
  topic: string,
  settings: GenerationSettings,
  config: LlmConfig,
): Promise<GenerateFromChunksResult> {
  const trimmed = topic.trim();
  if (!trimmed) {
    return { cards: [], tokenUsage: 0, detail: "Topic is required." };
  }

  const requestedTypes = parseGenerationSettings(settings).cardTypes;
  const requestedLabel = requestedTypes.join(" / ");
  const multiType = requestedTypes.length > 1;
  const passes: GenerateChunkOptions[] = multiType
    ? requestedTypes.map((forceType) => ({
        forceType,
        cardCountScale: 1 / requestedTypes.length,
      }))
    : [{}];

  const allCards: GeneratedCard[] = [];
  let tokenUsage = 0;
  let wrongTypeCount = 0;
  const apiErrors: string[] = [];

  for (const pass of passes) {
    const { cards, tokenUsage: passTokens, rejected, apiError } = await generateTopicPass(
      trimmed,
      settings,
      config,
      pass,
    );
    if (apiError) apiErrors.push(apiError);
    wrongTypeCount += rejected;
    allCards.push(...cards);
    tokenUsage += passTokens;
  }

  const deduped = deduplicateCards(allCards).slice(0, MAX_CARDS_PER_JOB);

  if (deduped.length > 0) {
    return { cards: deduped, tokenUsage };
  }

  const detailParts: string[] = [];
  if (apiErrors.length > 0) {
    detailParts.push(apiErrors[0]!);
  } else if (wrongTypeCount > 0) {
    detailParts.push(
      `The model returned ${wrongTypeCount} card(s) that were the wrong type or invalid for ${requestedLabel}.`,
    );
  } else {
    detailParts.push("Try a different topic, card type, or detail level.");
  }

  return {
    cards: [],
    tokenUsage,
    detail: detailParts.join(" "),
  };
}

export function createMockCards(sourceRef: string, cardMix: CardMix = "basic"): GeneratedCard[] {
  const tags = normalizeGeneratedTags(["DeepHaus", sourceRef]);
  if (cardMix === "basic") {
    return [
      {
        type: "basic",
        front: "What does DeepHaus generate?",
        back: "Anki flashcards from text and PDF sources.",
        tags,
      },
    ];
  }

  return [
    {
      type: "cloze",
      clozeText: "{{c1::DeepHaus}} converts study material into {{c2::Anki}} decks.",
      extra: "Generated from your source material.",
      tags,
    },
  ];
}
