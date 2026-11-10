import { NextResponse } from "next/server";
import { z } from "zod";
import { createMockExplanation, createMockHints, explainCard, hintsForCard } from "@deephaus/llm";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { runChargedTutorCall } from "@/lib/cards/explain-charge";
import {
  loadCandidates,
  loadExplainCard,
  loadStoredExplanation,
  mergeHints,
  saveExplanation,
  toState,
  tutorInput,
  tutorKeys,
  tutorIsMocked,
} from "@/lib/cards/explain-store";

/**
 * The study window's Hint (before the answer is shown) and Explain (after).
 * GET reads what is saved, free. POST returns the saved result when it is
 * still current, and otherwise writes a new one for 1 credit.
 */

const kindSchema = z.enum(["explain", "hint"]);
const clozeOrdSchema = z.coerce.number().int().min(0).max(9).optional().nullable();

export const GET = withApiTiming(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;
  const url = new URL(request.url);
  const kind = kindSchema.safeParse(url.searchParams.get("kind") ?? "explain");
  const clozeOrd = clozeOrdSchema.safeParse(url.searchParams.get("cloze_ord") ?? undefined);
  if (!kind.success || !clozeOrd.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const supabase = await createClient();
  const card = await loadExplainCard(supabase, user!.id, id);
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  const row = await loadStoredExplanation(supabase, user!.id, id);
  return NextResponse.json(await toState(supabase, card, row, { kind: kind.data, clozeOrd: clozeOrd.data }));
}, "GET /api/cards/[id]/explain");

const postSchema = z.object({
  kind: kindSchema.default("explain"),
  cloze_ord: clozeOrdSchema,
  /** Write a new one even if a current one is saved (the "Write a new explanation" button). */
  rewrite: z.boolean().optional(),
});

export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser({ rateLimit: "costly" });
  if (response) return response;
  const { id } = await params;

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await request.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const supabase = await createClient();
  const card = await loadExplainCard(supabase, user!.id, id);
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  const row = await loadStoredExplanation(supabase, user!.id, id);
  const options = { kind: body.kind, clozeOrd: body.cloze_ord };

  const hasSaved =
    body.kind === "explain"
      ? !!row?.explanation
      : (row?.hints[String(body.cloze_ord && body.cloze_ord > 0 ? body.cloze_ord : 0)] ?? []).length > 0;
  // Reopening is free, and a saved result for a changed card is returned marked
  // stale: nothing is rewritten (or charged) until the student asks.
  if (hasSaved && !body.rewrite) {
    return NextResponse.json(await toState(supabase, card, row, options));
  }

  const mock = tutorIsMocked();
  const operation =
    body.kind === "explain" ? `card-explain:${id}` : `card-hint:${id}:${body.cloze_ord ?? 0}`;
  const outcome = await runChargedTutorCall({
    request,
    userId: user!.id,
    action: body.kind === "explain" ? "card-explain" : "card-hint",
    operation,
    cardId: id,
    charge: !mock,
    work: async () => {
      if (body.kind === "explain") {
        const { explanation, model } = mock
          ? { explanation: createMockExplanation(card), model: "mock" }
          : await explainCard(tutorInput(card), tutorKeys(), {
              candidates: await loadCandidates(supabase, card),
            });
        return saveExplanation(supabase, user!.id, card, row, {
          explanation,
          // A rewrite starts a fresh conversation about the new explanation.
          thread: [],
          model,
        });
      }
      const { hints, model } = mock
        ? { hints: createMockHints(card), model: "mock" }
        : await hintsForCard(tutorInput(card), tutorKeys(), { clozeOrd: body.cloze_ord });
      return saveExplanation(supabase, user!.id, card, row, {
        hints: mergeHints(card, row, body.cloze_ord, hints),
        model,
      });
    },
  });
  if ("response" in outcome) return outcome.response;
  return NextResponse.json(await toState(supabase, card, outcome.result, options));
}, "POST /api/cards/[id]/explain");
