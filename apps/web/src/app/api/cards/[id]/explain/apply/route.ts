import { NextResponse } from "next/server";
import { z } from "zod";
import type { ExplainThreadMessage } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  addSuggestedCard,
  applyCardFix,
  isStale,
  loadExplainCard,
  loadStoredExplanation,
  saveExplanation,
  toState,
} from "@/lib/cards/explain-store";

/**
 * Acts on a tutor suggestion, free: applies a fix to the card (from the
 * explanation's `card_issue` or a follow-up) or adds a suggested new card to
 * the same deck. A fix re-hashes the saved explanation so it stays current.
 */

const bodySchema = z.union([
  z.object({ from: z.literal("explanation") }),
  z.object({ message_index: z.number().int().min(0) }),
]);

export const POST = withApiTiming(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;
  const { id } = await params;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const supabase = await createClient();
  const card = await loadExplainCard(supabase, user!.id, id);
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });
  const row = await loadStoredExplanation(supabase, user!.id, id);
  if (!row || isStale(card, row)) {
    return NextResponse.json(
      { error: "The card changed since this suggestion. Write a new explanation first." },
      { status: 409 },
    );
  }

  try {
    if ("from" in body) {
      const issue = row.explanation?.card_issue;
      if (!issue) return NextResponse.json({ error: "No suggested fix." }, { status: 404 });
      const updated = await applyCardFix(supabase, card, issue.fix);
      const saved = await saveExplanation(supabase, user!.id, updated, row, {
        explanation: { ...row.explanation!, card_issue: null },
      });
      return NextResponse.json({
        state: await toState(supabase, updated, saved, { kind: "explain" }),
        card: pickCard(updated),
      });
    }

    const message = row.thread[body.message_index];
    const suggestion = message?.role === "assistant" ? message.suggestion : null;
    if (!suggestion) return NextResponse.json({ error: "No suggestion there." }, { status: 404 });
    if ((suggestion.kind === "fix" && suggestion.applied) || (suggestion.kind === "new_card" && suggestion.added)) {
      return NextResponse.json({ error: "Already done." }, { status: 409 });
    }

    const thread: ExplainThreadMessage[] = row.thread.map((m, i) =>
      i === body.message_index && m.suggestion
        ? {
            ...m,
            suggestion:
              m.suggestion.kind === "fix" ? { ...m.suggestion, applied: true } : { ...m.suggestion, added: true },
          }
        : m,
    );

    if (suggestion.kind === "fix") {
      const updated = await applyCardFix(supabase, card, suggestion.fix);
      const saved = await saveExplanation(supabase, user!.id, updated, row, { thread });
      return NextResponse.json({
        state: await toState(supabase, updated, saved, { kind: "explain" }),
        card: pickCard(updated),
      });
    }

    const created = await addSuggestedCard(supabase, card, suggestion.front, suggestion.back);
    const saved = await saveExplanation(supabase, user!.id, card, row, { thread });
    return NextResponse.json({
      state: await toState(supabase, card, saved, { kind: "explain" }),
      created_card_id: created.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't apply that.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}, "POST /api/cards/[id]/explain/apply");

function pickCard(card: { id: string; front: string | null; back: string | null; cloze_text: string | null; extra: string | null }) {
  return { id: card.id, front: card.front, back: card.back, cloze_text: card.cloze_text, extra: card.extra };
}
