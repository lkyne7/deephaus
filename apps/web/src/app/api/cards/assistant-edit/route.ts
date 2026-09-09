import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createMockEditedCards,
  editCardsWithInstruction,
  sanitizeEditedCard,
  type EditableCard,
  type LlmConfig,
} from "@deephaus/llm";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import {
  aiCreditsExhaustedResponse,
  creditIdempotencyKey,
  isAiCreditsExhaustedError,
  releaseAiCredits,
  reserveAiCredits,
  settleAiCredits,
} from "@/lib/credits/service";
import { createClient } from "@/lib/supabase/server";
import {
  ASSISTANT_EDIT_MAX_CARDS,
  assistantEditCredits,
  type AssistantEditResponse,
  type AssistantEditUpdatedCard,
} from "@/lib/cards/assistant-edit";

/**
 * POST /api/cards/assistant-edit
 * ---------------------------------------------------------------------
 * Bulk-edit cards with a natural-language instruction (Create page card
 * assistant). Scope is either an explicit `card_ids` list or the whole deck.
 * Changes are applied immediately; the client keeps an undo snapshot.
 */

const bodySchema = z.object({
  deck_id: z.string().uuid(),
  card_ids: z.array(z.string().uuid()).min(1).max(ASSISTANT_EDIT_MAX_CARDS).optional(),
  instruction: z.string().trim().min(1).max(1000),
});

const USE_MOCK = () =>
  process.env.DEEPHAUS_USE_MOCK_LLM === "true" || !process.env.OPENAI_API_KEY;

function llmConfig(): LlmConfig {
  return { apiKey: process.env.OPENAI_API_KEY ?? "" };
}

type CardRow = {
  id: string;
  type: EditableCard["type"];
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[] | null;
};

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;
  const userId = user!.id;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = await createClient();

  // Ownership: deck must belong to the caller.
  const { data: deck } = await supabase
    .from("projects")
    .select("id, name, deck_name")
    .eq("id", body.deck_id)
    .eq("user_id", userId)
    .single();
  if (!deck) return NextResponse.json({ error: "Deck not found" }, { status: 404 });

  let query = supabase
    .from("cards")
    .select(
      "id, type, front, back, cloze_text, extra, tags, generation_jobs!inner(sources!inner(project_id, projects!inner(user_id)))",
    )
    .eq("generation_jobs.sources.project_id", body.deck_id)
    .eq("generation_jobs.sources.projects.user_id", userId)
    .order("sort_order", { ascending: true })
    .limit(ASSISTANT_EDIT_MAX_CARDS + 1);

  if (body.card_ids) {
    query = query.in("id", [...new Set(body.card_ids)]);
  }

  const { data: rows, error: loadError } = await query;
  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }

  const cards = ((rows ?? []) as unknown as CardRow[]).map<EditableCard>((row) => ({
    id: row.id,
    type: row.type,
    front: row.front,
    back: row.back,
    cloze_text: row.cloze_text,
    extra: row.extra,
    tags: Array.isArray(row.tags) ? row.tags : [],
  }));

  if (cards.length === 0) {
    return NextResponse.json({ error: "No matching cards" }, { status: 404 });
  }
  if (cards.length > ASSISTANT_EDIT_MAX_CARDS) {
    return NextResponse.json(
      {
        error: `The assistant can edit up to ${ASSISTANT_EDIT_MAX_CARDS} cards at a time. Select a smaller set of cards and try again.`,
      },
      { status: 400 },
    );
  }

  const useMock = USE_MOCK();
  const credits = assistantEditCredits(cards.length);
  const idempotencyKey = creditIdempotencyKey(
    userId,
    "assistant:edit-cards",
    request.headers.get("idempotency-key"),
  );
  const input = {
    instruction: body.instruction,
    cards,
    deckName: deck.deck_name || deck.name,
  };

  try {
    if (!useMock) {
      await reserveAiCredits({
        userId,
        idempotencyKey,
        action: "assistant:edit-cards",
        reservedCredits: credits,
        resourceId: body.deck_id,
        metadata: { assistant_action: "edit-cards", card_count: cards.length },
      });
    }

    let result;
    try {
      result = useMock
        ? createMockEditedCards(input)
        : await editCardsWithInstruction(input, llmConfig());
    } catch (error) {
      if (!useMock) {
        try {
          await releaseAiCredits({ userId, idempotencyKey });
        } catch (releaseError) {
          console.error("[assistant-edit credits] failed to release reservation", releaseError);
        }
      }
      throw error;
    }

    if (!useMock) {
      await settleAiCredits({ userId, idempotencyKey, chargedCredits: credits });
    }

    const byId = new Map(cards.map((card) => [card.id, card]));
    const updated: AssistantEditUpdatedCard[] = [];
    const now = new Date().toISOString();

    for (const patch of result.cards) {
      const original = byId.get(patch.id);
      if (!original) continue;
      const update = sanitizeEditedCard(original, patch);
      if (!update) continue;

      const { data, error } = await supabase
        .from("cards")
        .update({ ...update, user_edited: true, updated_at: now })
        .eq("id", original.id)
        .select("id, front, back, cloze_text, extra, tags, user_edited, updated_at")
        .single();
      if (error || !data) {
        console.error("[assistant-edit] failed to update card", original.id, error);
        continue;
      }
      updated.push({
        id: data.id,
        front: data.front ?? null,
        back: data.back ?? null,
        cloze_text: data.cloze_text ?? null,
        extra: data.extra ?? null,
        tags: Array.isArray(data.tags) ? data.tags : [],
        user_edited: Boolean(data.user_edited),
        updated_at: data.updated_at ?? now,
      });
    }

    const payload: AssistantEditResponse = {
      updated,
      skipped: cards.length - updated.length,
      scope: cards.length,
      summary: result.summary,
    };
    return NextResponse.json(payload);
  } catch (err) {
    if (isAiCreditsExhaustedError(err)) {
      return aiCreditsExhaustedResponse(err);
    }
    const message = err instanceof Error ? err.message : "Assistant request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "POST /api/cards/assistant-edit");
