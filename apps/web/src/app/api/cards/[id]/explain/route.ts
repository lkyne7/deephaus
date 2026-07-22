import { NextResponse } from "next/server";
import { createMockExplanation, explainCard } from "@deephaus/llm";
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

export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();

  const { data: card, error } = await supabase
    .from("cards")
    .select(
      "id, type, front, back, cloze_text, extra, generation_jobs!inner(sources!inner(projects!inner(user_id)))",
    )
    .eq("id", id)
    .eq("generation_jobs.sources.projects.user_id", user!.id)
    .single();

  if (error || !card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const input = {
    type: card.type as "basic" | "cloze",
    front: card.front,
    back: card.back,
    cloze_text: card.cloze_text,
    extra: card.extra,
  };

  const useMock =
    process.env.DEEPHAUS_USE_MOCK_LLM === "true" || !process.env.OPENAI_API_KEY;
  const idempotencyKey = creditIdempotencyKey(
    user!.id,
    `card-explain:${id}`,
    request.headers.get("idempotency-key"),
  );
  let reserved = false;

  try {
    if (!useMock) {
      await reserveAiCredits({
        userId: user!.id,
        idempotencyKey,
        action: "card-explain",
        reservedCredits: 1,
        resourceType: "card",
        resourceId: id,
      });
      reserved = true;
    }

    const explanation = useMock
      ? createMockExplanation(input)
      : await explainCard(input, { apiKey: process.env.OPENAI_API_KEY! });

    if (reserved) {
      await settleAiCredits({
        userId: user!.id,
        idempotencyKey,
        chargedCredits: 1,
      });
    }
    return NextResponse.json({ explanation });
  } catch (err) {
    if (reserved) {
      try {
        await releaseAiCredits({ userId: user!.id, idempotencyKey });
      } catch (releaseError) {
        console.error("[card explain credits] failed to release reservation", releaseError);
      }
    }
    if (isAiCreditsExhaustedError(err)) {
      return aiCreditsExhaustedResponse(err);
    }
    const message = err instanceof Error ? err.message : "Failed to generate explanation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "POST /api/cards/[id]/explain");
