import { NextResponse } from "next/server";
import { z } from "zod";
import { EXPLAIN_THREAD_LIMIT, type ExplainThreadMessage } from "@deephaus/shared";
import { answerFollowUp, createMockFollowUp } from "@deephaus/llm";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runChargedTutorCall } from "@/lib/cards/explain-charge";
import {
  isStale,
  loadExplainCard,
  loadStoredExplanation,
  saveExplanation,
  toState,
  tutorInput,
  tutorKeys,
  tutorIsMocked,
} from "@/lib/cards/explain-store";

/** A follow-up question about a card after its explanation, 1 credit each. */

const bodySchema = z.object({ message: z.string().trim().min(1).max(1000) });

export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser({ rateLimit: "costly" });
  if (response) return response;
  const { id } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Write a question first." }, { status: 400 });
  }

  const supabase = await createClient();
  const card = await loadExplainCard(supabase, user!.id, id);
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  const row = await loadStoredExplanation(supabase, user!.id, id);
  // A changed card starts a new conversation.
  const thread = row && !isStale(card, row) ? row.thread : [];
  if (thread.length + 2 > EXPLAIN_THREAD_LIMIT) {
    return NextResponse.json(
      { error: "This conversation is full. Write a new explanation to start another." },
      { status: 409 },
    );
  }

  const mock = tutorIsMocked();
  const outcome = await runChargedTutorCall({
    request,
    userId: user!.id,
    action: "card-explain-ask",
    operation: `card-explain-ask:${id}:${thread.length}`,
    cardId: id,
    charge: !mock,
    work: async () => {
      const reply = mock
        ? { ...createMockFollowUp(body.message), model: "mock" }
        : await answerFollowUp(
            tutorInput(card),
            row && !isStale(card, row) ? row.explanation : null,
            thread,
            body.message,
            tutorKeys(),
          );
      const now = new Date().toISOString();
      const next: ExplainThreadMessage[] = [
        ...thread,
        { role: "user", text: body.message, created_at: now },
        { role: "assistant", text: reply.text, suggestion: reply.suggestion, created_at: now },
      ];
      return saveExplanation(supabase, user!.id, card, row, { thread: next, model: reply.model });
    },
  });
  if ("response" in outcome) return outcome.response;
  return NextResponse.json(await toState(supabase, card, outcome.result, { kind: "explain" }));
}, "POST /api/cards/[id]/explain/ask");
