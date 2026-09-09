import { NextResponse } from "next/server";
import {
  createMockCardMnemonic,
  createMockRegeneratedCard,
  generateCardMnemonic,
  regenerateCard,
  sanitizeRegeneratedCard,
  type LlmConfig,
  type RegenerateCardInput,
  type RegeneratedCardFields,
} from "@deephaus/llm";
import { parseGenerationSettings } from "@deephaus/shared";
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
  MNEMONIC_CREDITS,
  REGENERATE_CARD_CREDITS,
  supportsCardAiActions,
  type CardRewriteResponse,
} from "@/lib/cards/mnemonic";

/**
 * Shared implementation of the one-click card rewrites
 * (`POST /api/cards/[id]/mnemonic` and `POST /api/cards/[id]/regenerate`).
 *
 * Loads the card with an ownership check, asks the model for a new version of
 * the same type, validates it, persists the content fields (marking the card
 * user-edited) and returns the saved card. Costs one AI credit per call and
 * uses a deterministic mock when no LLM key is configured.
 */

export type CardRewriteAction = "mnemonic" | "regenerate";

const ACTION_META: Record<
  CardRewriteAction,
  { creditAction: string; credits: number; unsupported: string; unusable: string; failed: string }
> = {
  mnemonic: {
    creditAction: "cards:mnemonic",
    credits: MNEMONIC_CREDITS,
    unsupported: "Only front/back and fill-in-the-blank cards can be turned into mnemonic cards.",
    unusable: "The model did not produce a usable mnemonic version of this card. Try again.",
    failed: "Could not create a mnemonic card",
  },
  regenerate: {
    creditAction: "cards:regenerate",
    credits: REGENERATE_CARD_CREDITS,
    unsupported: "Only front/back and fill-in-the-blank cards can be regenerated.",
    unusable: "The model did not produce a usable new version of this card. Try again.",
    failed: "Could not regenerate the card",
  },
};

const USE_MOCK = () =>
  process.env.DEEPHAUS_USE_MOCK_LLM === "true" || !process.env.OPENAI_API_KEY;

function llmConfig(): LlmConfig {
  return { apiKey: process.env.OPENAI_API_KEY ?? "" };
}

type CardRow = {
  id: string;
  type: string;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[] | null;
  source_chunk_id: string | null;
  source_quote: string | null;
  generation_jobs: unknown;
};

type ProjectInfo = { name: string | null; deck_name: string | null; settings: unknown };

function projectFrom(row: CardRow): ProjectInfo | null {
  const gj = Array.isArray(row.generation_jobs) ? row.generation_jobs[0] : row.generation_jobs;
  const src = gj && typeof gj === "object" ? (gj as { sources?: unknown }).sources : null;
  const source = Array.isArray(src) ? src[0] : src;
  const proj =
    source && typeof source === "object" ? (source as { projects?: unknown }).projects : null;
  const project = Array.isArray(proj) ? proj[0] : proj;
  if (!project || typeof project !== "object") return null;
  return project as ProjectInfo;
}

export async function rewriteCardRoute(
  request: Request,
  id: string,
  action: CardRewriteAction,
): Promise<NextResponse> {
  const meta = ACTION_META[action];
  const { user, response } = await requireUser();
  if (response) return response;
  const userId = user!.id;

  const supabase = await createClient();
  const { data: card, error } = await supabase
    .from("cards")
    .select(
      "id, type, front, back, cloze_text, extra, tags, source_chunk_id, source_quote, generation_jobs!inner(sources!inner(projects!inner(user_id, name, deck_name, settings)))",
    )
    .eq("id", id)
    .eq("generation_jobs.sources.projects.user_id", userId)
    .single();

  if (error || !card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }
  const row = card as unknown as CardRow;
  if (!supportsCardAiActions(row.type)) {
    return NextResponse.json({ error: meta.unsupported }, { status: 400 });
  }

  // Grounding: the source chunk this card came from, when linked. Only the
  // regenerate action needs the whole passage; a mnemonic works from the card
  // itself plus the short evidence quote.
  let sourceContext: string | null = null;
  if (action === "regenerate" && row.source_chunk_id) {
    const { data: chunk } = await supabase
      .from("source_chunks")
      .select("content")
      .eq("id", row.source_chunk_id)
      .maybeSingle();
    sourceContext = (chunk?.content as string | null) ?? null;
  }

  const project = projectFrom(row);
  const settings = parseGenerationSettings(project?.settings ?? {});
  const original: RegenerateCardInput["card"] = {
    type: row.type,
    front: row.front,
    back: row.back,
    cloze_text: row.cloze_text,
    extra: row.extra,
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
  const deckName = project?.deck_name || project?.name || null;

  const useMock = USE_MOCK();
  const idempotencyKey = creditIdempotencyKey(
    userId,
    meta.creditAction,
    request.headers.get("idempotency-key"),
  );

  const generate = async (): Promise<RegeneratedCardFields> => {
    if (action === "mnemonic") {
      const input = {
        card: original,
        sourceQuote: row.source_quote,
        deckName,
        clozeHints: settings.clozeHints,
      };
      return useMock
        ? createMockCardMnemonic(input).card
        : (await generateCardMnemonic(input, llmConfig())).card;
    }
    const input: RegenerateCardInput = {
      card: original,
      sourceQuote: row.source_quote,
      sourceContext,
      deckName,
      clozeHints: settings.clozeHints,
    };
    return useMock
      ? createMockRegeneratedCard(input).card
      : (await regenerateCard(input, llmConfig())).card;
  };

  try {
    let generated: RegeneratedCardFields;
    if (useMock) {
      generated = await generate();
    } else {
      await reserveAiCredits({
        userId,
        idempotencyKey,
        action: meta.creditAction,
        reservedCredits: meta.credits,
        metadata: {
          card_id: id,
          card_type: row.type,
          grounded: Boolean(sourceContext || row.source_quote),
        },
      });
      try {
        generated = await generate();
        await settleAiCredits({ userId, idempotencyKey, chargedCredits: meta.credits });
      } catch (err) {
        try {
          await releaseAiCredits({ userId, idempotencyKey });
        } catch (releaseError) {
          console.error(`[${meta.creditAction} credits] failed to release reservation`, releaseError);
        }
        throw err;
      }
    }

    const fields = sanitizeRegeneratedCard(original, generated);
    if (!fields) {
      return NextResponse.json({ error: meta.unusable }, { status: 422 });
    }

    const updatedAt = new Date().toISOString();
    const { data: saved, error: updateError } = await supabase
      .from("cards")
      .update({ ...fields, user_edited: true, updated_at: updatedAt })
      .eq("id", id)
      .select("id, type, front, back, cloze_text, extra, tags, user_edited, updated_at")
      .single();
    if (updateError || !saved) {
      return NextResponse.json(
        { error: updateError?.message ?? `${meta.failed} (save failed)` },
        { status: 500 },
      );
    }

    const payload: CardRewriteResponse = {
      id: saved.id as string,
      type: row.type,
      front: (saved.front as string | null) ?? null,
      back: (saved.back as string | null) ?? null,
      cloze_text: (saved.cloze_text as string | null) ?? null,
      extra: (saved.extra as string | null) ?? null,
      tags: Array.isArray(saved.tags) ? (saved.tags as string[]) : [],
      user_edited: Boolean(saved.user_edited),
      updated_at: (saved.updated_at as string) ?? updatedAt,
    };
    return NextResponse.json(payload);
  } catch (err) {
    if (isAiCreditsExhaustedError(err)) return aiCreditsExhaustedResponse(err);
    const message = err instanceof Error ? err.message : meta.failed;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
