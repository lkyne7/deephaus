import { beforeEach, describe, expect, it, vi } from "vitest";
import { cardContentHash } from "@deephaus/shared";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  explainCard: vi.fn(),
  hintsForCard: vi.fn(),
  answerFollowUp: vi.fn(),
  reserveAiCredits: vi.fn(),
  settleAiCredits: vi.fn(),
  releaseAiCredits: vi.fn(),
  loadExplainCard: vi.fn(),
  loadStoredExplanation: vi.fn(),
  loadCandidates: vi.fn(),
  saveExplanation: vi.fn(),
  applyCardFix: vi.fn(),
  addSuggestedCard: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@deephaus/llm", () => {
  class TutorError extends Error {}
  return {
    TutorError,
    explainCard: mocks.explainCard,
    hintsForCard: mocks.hintsForCard,
    answerFollowUp: mocks.answerFollowUp,
    createMockExplanation: vi.fn(),
    createMockHints: vi.fn(),
    createMockFollowUp: vi.fn(),
  };
});
vi.mock("@/lib/credits/service", () => {
  class AiCreditsExhaustedError extends Error {}
  return {
    creditIdempotencyKey: (userId: string, operation: string, key: string | null) => `${operation}:${userId}:${key}`,
    reserveAiCredits: mocks.reserveAiCredits,
    settleAiCredits: mocks.settleAiCredits,
    releaseAiCredits: mocks.releaseAiCredits,
    isAiCreditsExhaustedError: (err: unknown) => err instanceof AiCreditsExhaustedError,
    aiCreditsExhaustedResponse: () => new Response(JSON.stringify({ error: "out" }), { status: 402 }),
    AiCreditsExhaustedError,
  };
});
vi.mock("@/lib/cards/explain-store", async () => {
  const shared = await import("@deephaus/shared");
  const isStale = (card: Parameters<typeof shared.cardContentHash>[0], row: { content_hash: string } | null) =>
    !!row && row.content_hash !== shared.cardContentHash(card);
  return {
    loadExplainCard: mocks.loadExplainCard,
    loadStoredExplanation: mocks.loadStoredExplanation,
    loadCandidates: mocks.loadCandidates,
    saveExplanation: mocks.saveExplanation,
    applyCardFix: mocks.applyCardFix,
    addSuggestedCard: mocks.addSuggestedCard,
    isStale,
    mergeHints: (_card: unknown, row: { hints?: Record<string, string[]> } | null, ord: number | null, hints: string[]) => ({
      ...(row?.hints ?? {}),
      [shared.hintKey(ord)]: hints,
    }),
    tutorInput: (card: unknown) => card,
    tutorKeys: () => ({ anthropicApiKey: "test" }),
    tutorIsMocked: () => false,
    toState: async (_s: unknown, card: { id: string }, row: Record<string, unknown> | null, options: { kind: "explain" | "hint"; clozeOrd?: number | null }) =>
      shared.buildCardExplainState(row as never, { card: card as never, source: null }, options),
  };
});

import { GET, POST } from "@/app/api/cards/[id]/explain/route";
import { POST as ASK } from "@/app/api/cards/[id]/explain/ask/route";
import { POST as APPLY } from "@/app/api/cards/[id]/explain/apply/route";
import { AiCreditsExhaustedError } from "@/lib/credits/service";
import { TutorError } from "@deephaus/llm";

const CARD_ID = "11111111-1111-4111-8111-111111111111";
const card = {
  id: CARD_ID,
  job_id: "job",
  type: "basic" as const,
  front: "Damage to which area impairs speech production?",
  back: "Broca's area",
  cloze_text: null,
  extra: null,
  source_quote: "Broca's area is involved in speech production.",
  sort_order: 0,
  project_id: "deck",
  source: { id: "src", title: "Psychology 2e" },
};
const explanation = {
  gist: "It turns meaning into speech.",
  why: ["Left frontal lobe."],
  confusable: null,
  hook: null,
  card_issue: null,
};
const ctx = { params: Promise.resolve({ id: CARD_ID }) };

function post(body: unknown, key = "tap-1") {
  return new Request(`https://app.test/api/cards/${CARD_ID}/explain`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

function savedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row",
    card_id: CARD_ID,
    content_hash: cardContentHash(card),
    explanation: null,
    hints: {},
    thread: [],
    updated_at: "2026-11-10T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
  mocks.createClient.mockResolvedValue({});
  mocks.loadExplainCard.mockResolvedValue(card);
  mocks.loadStoredExplanation.mockResolvedValue(null);
  mocks.loadCandidates.mockResolvedValue([]);
  mocks.reserveAiCredits.mockResolvedValue({});
  mocks.settleAiCredits.mockResolvedValue({});
  // The real rule: what was saved for another version of the card is kept
  // only when the patch names it.
  mocks.saveExplanation.mockImplementation(async (_s, _u, c, row, patch) => {
    const keep = row && row.content_hash === cardContentHash(c) ? row : null;
    return savedRow({
      explanation: patch.explanation !== undefined ? patch.explanation : (keep?.explanation ?? null),
      hints: patch.hints ?? keep?.hints ?? {},
      thread: patch.thread ?? keep?.thread ?? [],
      content_hash: cardContentHash(c),
    });
  });
});

describe("POST /api/cards/[id]/explain", () => {
  it("charges 1 credit for the first explanation and saves it", async () => {
    mocks.explainCard.mockResolvedValue({ explanation, model: "anthropic:claude-haiku-5-5@low" });
    const res = await POST(post({ kind: "explain" }), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.explanation.gist).toBe(explanation.gist);
    expect(body.stale).toBe(false);
    expect(mocks.reserveAiCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "card-explain",
        reservedCredits: 1,
        idempotencyKey: `card-explain:${CARD_ID}:user-1:tap-1`,
      }),
    );
    expect(mocks.settleAiCredits).toHaveBeenCalledWith(expect.objectContaining({ chargedCredits: 1 }));
    expect(mocks.saveExplanation).toHaveBeenCalledOnce();
  });

  it("reopens a saved explanation for free without calling the tutor", async () => {
    mocks.loadStoredExplanation.mockResolvedValue(savedRow({ explanation }));
    const res = await POST(post({ kind: "explain" }), ctx);
    expect((await res.json()).explanation.gist).toBe(explanation.gist);
    expect(mocks.explainCard).not.toHaveBeenCalled();
    expect(mocks.reserveAiCredits).not.toHaveBeenCalled();
  });

  it("marks a changed card stale and waits for an explicit rewrite before charging", async () => {
    mocks.loadStoredExplanation.mockResolvedValue(savedRow({ explanation, content_hash: "v1:old" }));
    const res = await POST(post({ kind: "explain" }), ctx);
    expect((await res.json()).stale).toBe(true);
    expect(mocks.reserveAiCredits).not.toHaveBeenCalled();

    mocks.explainCard.mockResolvedValue({ explanation: { ...explanation, gist: "New" }, model: "m" });
    const rewritten = await POST(post({ kind: "explain", rewrite: true }), ctx);
    const body = await rewritten.json();
    expect(body.explanation.gist).toBe("New");
    expect(body.stale).toBe(false);
    expect(mocks.reserveAiCredits).toHaveBeenCalledOnce();
  });

  it("uses the same credit key when the same tap is retried", async () => {
    mocks.explainCard.mockResolvedValue({ explanation, model: "m" });
    await POST(post({ kind: "explain" }, "tap-9"), ctx);
    await POST(post({ kind: "explain" }, "tap-9"), ctx);
    const keys = mocks.reserveAiCredits.mock.calls.map(([arg]) => arg.idempotencyKey);
    expect(new Set(keys).size).toBe(1);
  });

  it("returns 402 before calling the tutor when credits are exhausted", async () => {
    mocks.reserveAiCredits.mockRejectedValue(new (AiCreditsExhaustedError as unknown as new (m: string) => Error)("out"));
    const res = await POST(post({ kind: "explain" }), ctx);
    expect(res.status).toBe(402);
    expect(mocks.explainCard).not.toHaveBeenCalled();
  });

  it("releases the reservation when the tutor fails", async () => {
    mocks.explainCard.mockRejectedValue(new TutorError("declined"));
    const res = await POST(post({ kind: "explain" }), ctx);
    expect(res.status).toBe(502);
    expect(mocks.releaseAiCredits).toHaveBeenCalledOnce();
    expect(mocks.settleAiCredits).not.toHaveBeenCalled();
  });

  it("returns hints without the explanation, the source or the answer", async () => {
    mocks.loadStoredExplanation.mockResolvedValue(savedRow({ explanation }));
    mocks.hintsForCard.mockResolvedValue({ hints: ["Left frontal lobe.", "Named after a doctor."], model: "m" });
    const res = await POST(post({ kind: "hint" }), ctx);
    const body = await res.json();
    expect(body.hints).toEqual(["Left frontal lobe.", "Named after a doctor."]);
    expect(body.explanation).toBeNull();
    expect(body.source).toBeNull();
    expect(JSON.stringify(body)).not.toContain("Broca");
    expect(mocks.reserveAiCredits).toHaveBeenCalledWith(expect.objectContaining({ action: "card-hint" }));
  });

  it("keeps hints per cloze ordinal", async () => {
    mocks.loadStoredExplanation.mockResolvedValue(savedRow({ hints: { "1": ["first"] } }));
    const cached = await POST(post({ kind: "hint", cloze_ord: 1 }), ctx);
    expect((await cached.json()).hints).toEqual(["first"]);
    expect(mocks.hintsForCard).not.toHaveBeenCalled();

    mocks.hintsForCard.mockResolvedValue({ hints: ["second"], model: "m" });
    const fresh = await POST(post({ kind: "hint", cloze_ord: 2 }), ctx);
    expect((await fresh.json()).hints).toEqual(["second"]);
    expect(mocks.hintsForCard).toHaveBeenCalledWith(expect.anything(), expect.anything(), { clozeOrd: 2 });
  });
});

describe("GET /api/cards/[id]/explain", () => {
  it("reads what is saved without charging", async () => {
    mocks.loadStoredExplanation.mockResolvedValue(savedRow({ explanation }));
    const res = await GET(new Request(`https://app.test/api/cards/${CARD_ID}/explain?kind=explain`), ctx);
    expect((await res.json()).explanation.gist).toBe(explanation.gist);
    expect(mocks.reserveAiCredits).not.toHaveBeenCalled();
  });

  it("returns 404 for a card the user does not own", async () => {
    mocks.loadExplainCard.mockResolvedValue(null);
    const res = await GET(new Request(`https://app.test/api/cards/${CARD_ID}/explain`), ctx);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/cards/[id]/explain/ask", () => {
  it("charges 1 credit and appends the question and answer", async () => {
    mocks.loadStoredExplanation.mockResolvedValue(savedRow({ explanation }));
    mocks.answerFollowUp.mockResolvedValue({
      text: "Usually the left side.",
      suggestion: { kind: "new_card", front: "Which hemisphere?", back: "Left" },
      model: "m",
    });
    const res = await ASK(post({ message: "Always the left?" }), ctx);
    const body = await res.json();
    expect(body.thread).toHaveLength(2);
    expect(body.thread[1].suggestion.kind).toBe("new_card");
    expect(mocks.reserveAiCredits).toHaveBeenCalledWith(expect.objectContaining({ action: "card-explain-ask" }));
  });

  it("refuses once the conversation is full", async () => {
    const thread = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      text: "x",
      created_at: "t",
    }));
    mocks.loadStoredExplanation.mockResolvedValue(savedRow({ explanation, thread }));
    const res = await ASK(post({ message: "One more?" }), ctx);
    expect(res.status).toBe(409);
    expect(mocks.reserveAiCredits).not.toHaveBeenCalled();
  });
});

describe("POST /api/cards/[id]/explain/apply", () => {
  it("applies a follow-up fix, marks it applied and keeps the explanation current", async () => {
    const thread = [
      { role: "user", text: "Which side?", created_at: "t" },
      { role: "assistant", text: "Left.", suggestion: { kind: "fix", fix: { back: "Broca's area, left frontal lobe" } }, created_at: "t" },
    ];
    mocks.loadStoredExplanation.mockResolvedValue(savedRow({ explanation, thread }));
    mocks.applyCardFix.mockImplementation(async (_s, c, fix) => ({ ...c, ...fix }));
    const res = await APPLY(post({ message_index: 1 }), ctx);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.card.back).toBe("Broca's area, left frontal lobe");
    expect(body.state.thread[1].suggestion.applied).toBe(true);
    expect(body.state.stale).toBe(false);
    // The card's text changed, and the explanation it was fixed from stays.
    expect(body.state.explanation?.gist).toBe(explanation.gist);
    expect(mocks.reserveAiCredits).not.toHaveBeenCalled();
  });

  it("adds a suggested card once", async () => {
    const thread = [
      { role: "user", text: "q", created_at: "t" },
      { role: "assistant", text: "a", suggestion: { kind: "new_card", front: "F", back: "B" }, created_at: "t" },
    ];
    mocks.loadStoredExplanation.mockResolvedValue(savedRow({ explanation, thread }));
    mocks.addSuggestedCard.mockResolvedValue({ id: "new-card" });
    const res = await APPLY(post({ message_index: 1 }), ctx);
    expect((await res.json()).created_card_id).toBe("new-card");

    mocks.loadStoredExplanation.mockResolvedValue(
      savedRow({ explanation, thread: [thread[0], { ...thread[1], suggestion: { ...thread[1].suggestion, added: true } }] }),
    );
    const again = await APPLY(post({ message_index: 1 }), ctx);
    expect(again.status).toBe(409);
  });

  it("refuses a suggestion written for an older version of the card", async () => {
    mocks.loadStoredExplanation.mockResolvedValue(
      savedRow({ explanation: { ...explanation, card_issue: { problem: "p", fix: { back: "x" } } }, content_hash: "v1:old" }),
    );
    const res = await APPLY(post({ from: "explanation" }), ctx);
    expect(res.status).toBe(409);
    expect(mocks.applyCardFix).not.toHaveBeenCalled();
  });
});
