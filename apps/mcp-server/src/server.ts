import { ApiError } from "@deephaus/api-client";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DeepHausClient } from "@deephaus/api-client";
import { presentQueueCard } from "./format.js";
import { SERVER_INSTRUCTIONS, STUDY_SESSION_PROMPT } from "./prompts.js";

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(error: unknown) {
  if (error instanceof ApiError) {
    return {
      content: [{ type: "text" as const, text: `DeepHaus API error (${error.status}): ${error.message}` }],
      isError: true as const,
    };
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

const gradeSchema = z.enum(["again", "hard", "good", "easy"]);
const cardInputSchema = z.object({
  type: z.enum(["basic", "cloze"]).default("basic"),
  front: z.string().optional(),
  back: z.string().optional(),
  cloze_text: z.string().optional(),
  extra: z.string().optional(),
  tags: z.array(z.string()).optional(),
  source_quote: z.string().optional(),
});

export function registerDeepHausTools(server: McpServer, api: DeepHausClient) {
  server.registerTool(
    "list_decks",
    {
      description: "List DeepHaus decks with due and new card counts.",
      inputSchema: {},
    },
    async () => {
      try {
        const data = await api.listStudyDecks();
        return jsonResult(data);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_study_queue",
    {
      description:
        "Fetch the next cards to review for a deck. By default returns question-only payloads.",
      inputSchema: {
        deck_id: z.string().uuid().describe("Deck/project UUID"),
        limit: z.number().int().min(1).max(200).optional().describe("Max cards to return"),
        include_answers: z
          .boolean()
          .optional()
          .describe("When true, include backs/cloze answers in the payload"),
      },
    },
    async ({ deck_id, limit, include_answers }) => {
      try {
        const data = await api.getStudyQueue(deck_id, { limit });
        const includeAnswers = include_answers ?? false;
        return jsonResult({
          deck: data.deck,
          counts: data.counts,
          cards: data.cards.map((card) => presentQueueCard(card, includeAnswers)),
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "submit_review",
    {
      description: "Submit an FSRS-5 grade for a card after the user attempts recall.",
      inputSchema: {
        card_id: z.string().uuid(),
        grade: gradeSchema,
        cloze_ord: z.number().int().min(0).optional(),
      },
    },
    async ({ card_id, grade, cloze_ord }) => {
      try {
        const data = await api.submitReview(card_id, { grade, cloze_ord });
        return jsonResult(data);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_deck",
    {
      description: "Create a new DeepHaus deck/project for cards generated from conversation content.",
      inputSchema: {
        name: z.string().min(1).max(120).describe("Project name"),
        deck_name: z.string().min(1).max(120).optional().describe("Display name in study UI"),
      },
    },
    async ({ name, deck_name }) => {
      try {
        const deck = await api.createProject({
          name,
          deck_name: deck_name ?? name,
        });
        return jsonResult(deck);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "create_cards",
    {
      description: "Create one or more flashcards on a deck from content you authored in the chat.",
      inputSchema: {
        deck_id: z.string().uuid(),
        cards: z.array(cardInputSchema).min(1).max(50),
        append: z.boolean().optional().describe("Append after existing cards (default true)"),
      },
    },
    async ({ deck_id, cards, append }) => {
      try {
        const created = [];
        for (const card of cards) {
          const row = await api.createCard({
            project_id: deck_id,
            type: card.type,
            front: card.front ?? null,
            back: card.back ?? null,
            cloze_text: card.cloze_text ?? null,
            extra: card.extra ?? null,
            tags: card.tags ?? [],
            source_quote: card.source_quote ?? null,
            append: append ?? true,
          });
          created.push(row);
        }
        return jsonResult({ count: created.length, cards: created });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_card",
    {
      description: "Fetch a single card with full front/back content (for answer reveal).",
      inputSchema: {
        card_id: z.string().uuid(),
      },
    },
    async ({ card_id }) => {
      try {
        const card = await api.getCard(card_id);
        return jsonResult(card);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_study_stats",
    {
      description: "Dashboard stats: due counts, streak, retention, reviews today.",
      inputSchema: {},
    },
    async () => {
      try {
        const stats = await api.getDashboardStats();
        return jsonResult(stats);
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

export function registerDeepHausPrompts(server: McpServer) {
  server.registerPrompt(
    "deephaus_study_session",
    {
      title: "DeepHaus study session",
      description: "Protocol for running an FSRS-5 review session inside the chat.",
      argsSchema: {
        deck_id: z
          .string()
          .uuid()
          .optional()
          .describe("Optional deck UUID to study immediately"),
      },
    },
    async ({ deck_id }) => {
      const deckHint = deck_id ? `\n\nPreferred deck_id: ${deck_id}` : "";
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `${STUDY_SESSION_PROMPT}${deckHint}`,
            },
          },
        ],
      };
    },
  );
}

export function createDeepHausMcpServer(api: DeepHausClient): McpServer {
  const server = new McpServer(
    {
      name: "deephaus",
      version: "0.1.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerDeepHausTools(server, api);
  registerDeepHausPrompts(server);
  return server;
}
