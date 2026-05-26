import { NextResponse } from "next/server";
import { createMockExplanation, explainCard } from "@deephaus/llm";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const POST = withApiTiming(async function POST(
  _request: Request,
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

  try {
    const explanation = useMock
      ? createMockExplanation(input)
      : await explainCard(input, { apiKey: process.env.OPENAI_API_KEY! });

    return NextResponse.json({ explanation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate explanation";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "POST /api/cards/[id]/explain");
