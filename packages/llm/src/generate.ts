import OpenAI from "openai";
import {
  deduplicateCards,
  generatedCardsResponseSchema,
  parseGenerationSettings,
  type CardMix,
  type GeneratedCard,
  type GenerationSettings,
  type TextChunk,
  MAX_CARDS_PER_JOB,
} from "@deephaus/shared";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";

export interface LlmConfig {
  apiKey: string;
  model?: string;
}

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

function sanitizeCard(
  card: GeneratedCard,
  requestedTypes: CardMix[],
): GeneratedCard | null {
  if (card.type !== "basic" && card.type !== "cloze") return null;
  if (!requestedTypes.includes(card.type)) return null;

  if (card.type === "basic") {
    if (!card.front?.trim() || !card.back?.trim()) return null;
    return {
      type: "basic",
      front: card.front.trim(),
      back: card.back.trim(),
      tags: card.tags ?? [],
    };
  }

  const clozeText = normalizeClozeText(card.clozeText ?? "");
  if (!clozeText) return null;
  const clozeNumbers = [...clozeText.matchAll(/\{\{c(\d+)::/g)].map((m) =>
    Number(m[1]),
  );
  if (clozeNumbers.length === 0 || Math.max(...clozeNumbers) > 9) return null;

  return {
    type: "cloze",
    clozeText,
    extra: card.extra?.trim() || undefined,
    tags: card.tags ?? [],
  };
}

export async function generateCardsFromChunk(
  chunk: TextChunk,
  settings: GenerationSettings,
  config: LlmConfig,
): Promise<{ cards: GeneratedCard[]; tokenUsage: number; rejected: number; apiError?: string }> {
  const client = new OpenAI({ apiKey: config.apiKey });
  const model = config.model ?? "gpt-4o-mini";
  const requestedTypes = parseGenerationSettings(settings).cardTypes;

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
                    tags: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                  required: ["type", "front", "back", "clozeText", "extra", "tags"],
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
        { role: "system", content: buildSystemPrompt(settings) },
        { role: "user", content: buildUserPrompt(chunk) },
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
    .map((card) => sanitizeCard(card, requestedTypes))
    .filter((c): c is GeneratedCard => c !== null);

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

  for (let i = 0; i < chunks.length; i += 1) {
    const { cards, tokenUsage: chunkTokens, rejected, apiError } = await generateCardsFromChunk(
      chunks[i],
      settings,
      config,
    );
    if (apiError) apiErrors.push(apiError);
    wrongTypeCount += rejected;
    allCards.push(...cards);
    tokenUsage += chunkTokens;
    onProgress?.(i + 1, chunks.length);

    if (allCards.length >= MAX_CARDS_PER_JOB) break;
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

export function createMockCards(sourceRef: string, cardMix: CardMix = "basic"): GeneratedCard[] {
  const tag = sourceRef.replace(/::/g, "::");
  if (cardMix === "basic") {
    return [
      {
        type: "basic",
        front: "What does DeepHaus generate?",
        back: "Anki flashcards from text and PDF sources.",
        tags: ["DeepHaus::Mock", tag].filter(Boolean),
      },
    ];
  }

  return [
    {
      type: "cloze",
      clozeText: "{{c1::DeepHaus}} converts study material into {{c2::Anki}} decks.",
      extra: "Generated from your source material.",
      tags: ["DeepHaus::Mock", tag].filter(Boolean),
    },
  ];
}
