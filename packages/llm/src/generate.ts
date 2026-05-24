import OpenAI from "openai";
import {
  deduplicateCards,
  generatedCardsResponseSchema,
  type GeneratedCard,
  type GenerationSettings,
  type TextChunk,
  MAX_CARDS_PER_JOB,
} from "@sluggo/shared";
import { buildSystemPrompt, buildUserPrompt } from "./prompts.js";

export interface LlmConfig {
  apiKey: string;
  model?: string;
}

export interface GenerateFromChunksResult {
  cards: GeneratedCard[];
  tokenUsage: number;
}

function sanitizeCard(card: GeneratedCard): GeneratedCard | null {
  if (card.type === "basic") {
    if (!card.front?.trim() || !card.back?.trim()) return null;
    return {
      type: "basic",
      front: card.front.trim(),
      back: card.back.trim(),
      extra: card.extra?.trim(),
      tags: card.tags ?? [],
    };
  }

  if (!card.clozeText?.trim()) return null;
  const clozeNumbers = [...card.clozeText.matchAll(/\{\{c(\d+)::/g)].map((m) =>
    Number(m[1]),
  );
  if (clozeNumbers.length === 0 || Math.max(...clozeNumbers) > 3) return null;

  return {
    type: "cloze",
    clozeText: card.clozeText.trim(),
    extra: card.extra?.trim(),
    tags: card.tags ?? [],
  };
}

export async function generateCardsFromChunk(
  chunk: TextChunk,
  settings: GenerationSettings,
  config: LlmConfig,
): Promise<{ cards: GeneratedCard[]; tokenUsage: number }> {
  const client = new OpenAI({ apiKey: config.apiKey });
  const model = config.model ?? "gpt-4o-mini";

  const response = await client.chat.completions.create({
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

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return { cards: [], tokenUsage: response.usage?.total_tokens ?? 0 };
  }

  const parsed = generatedCardsResponseSchema.safeParse(JSON.parse(content));
  if (!parsed.success) {
    return { cards: [], tokenUsage: response.usage?.total_tokens ?? 0 };
  }

  const cards = parsed.data.cards
    .map(sanitizeCard)
    .filter((c): c is GeneratedCard => c !== null);

  return { cards, tokenUsage: response.usage?.total_tokens ?? 0 };
}

export async function generateCardsFromChunks(
  chunks: TextChunk[],
  settings: GenerationSettings,
  config: LlmConfig,
  onProgress?: (completed: number, total: number) => void,
): Promise<GenerateFromChunksResult> {
  const allCards: GeneratedCard[] = [];
  let tokenUsage = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    const { cards, tokenUsage: chunkTokens } = await generateCardsFromChunk(
      chunks[i],
      settings,
      config,
    );
    allCards.push(...cards);
    tokenUsage += chunkTokens;
    onProgress?.(i + 1, chunks.length);

    if (allCards.length >= MAX_CARDS_PER_JOB) break;
  }

  const deduped = deduplicateCards(allCards).slice(0, MAX_CARDS_PER_JOB);
  return { cards: deduped, tokenUsage };
}

export function createMockCards(sourceRef: string): GeneratedCard[] {
  return [
    {
      type: "basic",
      front: "What does Sluggo generate?",
      back: "Anki flashcards from text and PDF sources.",
      extra: sourceRef,
      tags: ["Sluggo::Mock"],
    },
    {
      type: "cloze",
      clozeText: "{{c1::Sluggo}} converts study material into {{c2::Anki}} decks.",
      extra: sourceRef,
      tags: ["Sluggo::Mock"],
    },
  ];
}
