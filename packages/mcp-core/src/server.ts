import { ApiError } from "@deephaus/api-client";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CardUpdateBody, DeepHausClient } from "@deephaus/api-client";
import { presentBrowseCard, presentQueueCard } from "./format.js";
import { SERVER_INSTRUCTIONS, STUDY_SESSION_PROMPT } from "./prompts.js";

/**
 * Per-call API client factory. Stdio passes a constant env-token client;
 * the hosted /api/mcp route builds one from the request's bearer token
 * (available on `extra.authInfo`).
 */
export type GetApi = (extra: { authInfo?: AuthInfo }) => DeepHausClient | Promise<DeepHausClient>;

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

type CardInput = z.infer<typeof cardInputSchema>;

const CLOZE_PATTERN = /\{\{c\d+::[^}]+\}\}/;

/** Validate a card before creation; returns a human-readable problem or null. */
function validateCardInput(card: CardInput): string | null {
  if (card.type === "cloze") {
    if (!card.cloze_text?.trim()) {
      return "Cloze cards require cloze_text.";
    }
    if (!CLOZE_PATTERN.test(card.cloze_text)) {
      return "cloze_text must contain at least one {{c1::answer}} deletion.";
    }
    return null;
  }
  if (!card.front?.trim()) return "Basic cards require a non-empty front.";
  if (!card.back?.trim()) return "Basic cards require a non-empty back.";
  return null;
}

export function registerDeepHausTools(server: McpServer, getApi: GetApi) {
  server.registerTool(
    "list_decks",
    {
      title: "List decks",
      description: "List DeepHaus decks with due and new card counts.",
      inputSchema: {},
      annotations: { title: "List decks", readOnlyHint: true },
    },
    async (_args, extra) => {
      try {
        const api = await getApi(extra);
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
      title: "Get study queue",
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
      annotations: { title: "Get study queue", readOnlyHint: true },
    },
    async ({ deck_id, limit, include_answers }, extra) => {
      try {
        const api = await getApi(extra);
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
      title: "Submit review",
      description: "Submit an FSRS-5 grade for a card after the user attempts recall.",
      inputSchema: {
        card_id: z.string().uuid(),
        grade: gradeSchema,
        cloze_ord: z.number().int().min(0).optional(),
      },
      // Destructive in the sense that it permanently alters FSRS scheduling state.
      annotations: { title: "Submit review", readOnlyHint: false, destructiveHint: true },
    },
    async ({ card_id, grade, cloze_ord }, extra) => {
      try {
        const api = await getApi(extra);
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
      title: "Create deck",
      description: "Create a new DeepHaus deck/project for cards generated from conversation content.",
      inputSchema: {
        name: z.string().min(1).max(120).describe("Project name"),
        deck_name: z.string().min(1).max(120).optional().describe("Display name in study UI"),
      },
      annotations: { title: "Create deck", readOnlyHint: false, destructiveHint: false },
    },
    async ({ name, deck_name }, extra) => {
      try {
        const api = await getApi(extra);
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
      title: "Create cards",
      description:
        "Create one or more flashcards on a deck from content you authored in the chat. " +
        "Basic cards need front and back; cloze cards need cloze_text with {{c1::answer}} deletions. " +
        "Invalid or failed cards are reported individually — the rest are still created.",
      inputSchema: {
        deck_id: z.string().uuid(),
        cards: z.array(cardInputSchema).min(1).max(50),
        append: z.boolean().optional().describe("Append after existing cards (default true)"),
      },
      annotations: { title: "Create cards", readOnlyHint: false, destructiveHint: false },
    },
    async ({ deck_id, cards, append }, extra) => {
      try {
        const api = await getApi(extra);
        const created: unknown[] = [];
        const failed: Array<{ index: number; error: string }> = [];

        for (const [index, card] of cards.entries()) {
          const problem = validateCardInput(card);
          if (problem) {
            failed.push({ index, error: problem });
            continue;
          }
          try {
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
          } catch (error) {
            failed.push({
              index,
              error:
                error instanceof ApiError
                  ? `API error (${error.status}): ${error.message}`
                  : error instanceof Error
                    ? error.message
                    : "Unknown error",
            });
          }
        }

        const result = jsonResult({
          created_count: created.length,
          failed_count: failed.length,
          created,
          failed,
        });
        // Surface as an error only when nothing was created at all.
        return created.length === 0 && failed.length > 0
          ? { ...result, isError: true as const }
          : result;
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_card",
    {
      title: "Get card",
      description: "Fetch a single card with full front/back content (for answer reveal).",
      inputSchema: {
        card_id: z.string().uuid(),
      },
      annotations: { title: "Get card", readOnlyHint: true },
    },
    async ({ card_id }, extra) => {
      try {
        const api = await getApi(extra);
        const card = await api.getCard(card_id);
        return jsonResult(card);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "browse_cards",
    {
      title: "Browse cards",
      description:
        "Search and browse existing cards across decks. Filter by free-text query, tag, or deck; paginate with limit/offset.",
      inputSchema: {
        deck_id: z.string().uuid().optional().describe("Restrict to one deck"),
        q: z.string().optional().describe("Free-text search over card content"),
        tag: z.string().optional().describe("Filter by tag"),
        limit: z.number().int().min(1).max(100).optional().describe("Page size (default 50)"),
        offset: z.number().int().min(0).optional().describe("Pagination offset"),
      },
      annotations: { title: "Browse cards", readOnlyHint: true },
    },
    async ({ deck_id, q, tag, limit, offset }, extra) => {
      try {
        const api = await getApi(extra);
        const data = await api.browseCards({
          deck_id,
          q,
          tag,
          limit: limit ?? 50,
          offset,
        });
        return jsonResult({
          total: data.total,
          limit: data.limit,
          offset: data.offset,
          cards: data.cards.map(presentBrowseCard),
        });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "update_card",
    {
      title: "Update card",
      description:
        "Edit an existing card's content or tags. Only the provided fields are changed.",
      inputSchema: {
        card_id: z.string().uuid(),
        front: z.string().optional(),
        back: z.string().optional(),
        cloze_text: z.string().optional(),
        extra: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
      // Overwrites existing content, which cannot be recovered.
      annotations: { title: "Update card", readOnlyHint: false, destructiveHint: true },
    },
    async ({ card_id, front, back, cloze_text, extra: extraField, tags }, extra) => {
      try {
        const body: CardUpdateBody = {};
        if (front !== undefined) body.front = front;
        if (back !== undefined) body.back = back;
        if (cloze_text !== undefined) body.cloze_text = cloze_text;
        if (extraField !== undefined) body.extra = extraField;
        if (tags !== undefined) body.tags = tags;
        if (Object.keys(body).length === 0) {
          return {
            content: [{ type: "text" as const, text: "No fields to update were provided." }],
            isError: true as const,
          };
        }
        const api = await getApi(extra);
        const card = await api.updateCard(card_id, body);
        return jsonResult(card);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "delete_card",
    {
      title: "Delete card",
      description:
        "Permanently delete a card and its review history. Destructive — confirm with the user before calling.",
      inputSchema: {
        card_id: z.string().uuid(),
      },
      annotations: { title: "Delete card", readOnlyHint: false, destructiveHint: true },
    },
    async ({ card_id }, extra) => {
      try {
        const api = await getApi(extra);
        await api.deleteCard(card_id);
        return jsonResult({ deleted: true, card_id });
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "rename_deck",
    {
      title: "Rename deck",
      description: "Rename a deck (project name and study display name).",
      inputSchema: {
        deck_id: z.string().uuid(),
        name: z.string().min(1).max(120).describe("New deck name"),
      },
      annotations: { title: "Rename deck", readOnlyHint: false, destructiveHint: false },
    },
    async ({ deck_id, name }, extra) => {
      try {
        const api = await getApi(extra);
        const deck = await api.updateDeck(deck_id, { name, deck_name: name });
        return jsonResult(deck);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_deck_stats",
    {
      title: "Get deck stats",
      description: "Detailed stats for one deck: state breakdown, retention, forecast.",
      inputSchema: {
        deck_id: z.string().uuid(),
      },
      annotations: { title: "Get deck stats", readOnlyHint: true },
    },
    async ({ deck_id }, extra) => {
      try {
        const api = await getApi(extra);
        const stats = await api.getDeckStats(deck_id);
        return jsonResult(stats);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_study_stats",
    {
      title: "Get study stats",
      description: "Dashboard stats: due counts, streak, retention, reviews today.",
      inputSchema: {},
      annotations: { title: "Get study stats", readOnlyHint: true },
    },
    async (_args, extra) => {
      try {
        const api = await getApi(extra);
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

export function createDeepHausMcpServer(getApi: GetApi): McpServer {
  const server = new McpServer(
    {
      name: "deephaus",
      version: "0.2.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerDeepHausTools(server, getApi);
  registerDeepHausPrompts(server);
  return server;
}
