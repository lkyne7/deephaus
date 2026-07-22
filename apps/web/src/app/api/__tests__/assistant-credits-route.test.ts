import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const {
  createClient,
  hintForCard,
  releaseAiCredits,
  requireUser,
  reserveAiCredits,
  settleAiCredits,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  hintForCard: vi.fn(),
  releaseAiCredits: vi.fn(),
  requireUser: vi.fn(),
  reserveAiCredits: vi.fn(),
  settleAiCredits: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/credits/service", () => ({
  creditIdempotencyKey: (
    userId: string,
    operation: string,
    requestKey: string | null,
  ) => `${operation}:${userId}:${requestKey}`,
  reserveAiCredits,
  settleAiCredits,
  releaseAiCredits,
  isAiCreditsExhaustedError: (error: { code?: string }) =>
    error?.code === "AI_CREDITS_EXHAUSTED",
  aiCreditsExhaustedResponse: (error: {
    code: string;
    allowance: number;
    consumed: number;
    required: number;
  }) =>
    Response.json(
      {
        error: "AI credits exhausted.",
        code: error.code,
        allowance: error.allowance,
        consumed: error.consumed,
        required: error.required,
      },
      { status: 402 },
    ),
}));
vi.mock("@deephaus/llm", () => ({
  collectionOverview: vi.fn(),
  createMockCollectionOverview: vi.fn(),
  createMockCritique: vi.fn(),
  createMockDeckSummary: vi.fn(),
  createMockFocusPrompt: vi.fn(),
  createMockHint: vi.fn(),
  createMockMnemonic: vi.fn(),
  createMockRecommendDecks: vi.fn(),
  createMockStatsInsights: vi.fn(),
  createMockStudyPlan: vi.fn(),
  createMockWeakSpots: vi.fn(),
  critiqueCard: vi.fn(),
  deckWeakSpots: vi.fn(),
  hintForCard,
  mnemonicForCard: vi.fn(),
  recommendDecks: vi.fn(),
  statsInsights: vi.fn(),
  studyPlan: vi.fn(),
  suggestFocusPrompt: vi.fn(),
  summarizeDeck: vi.fn(),
}));
vi.mock("@/lib/fsrs/dashboard-metrics", () => ({
  loadDashboardMetricsBundle: vi.fn(),
}));
vi.mock("@/lib/community/load-community-decks", () => ({
  loadCommunityDecks: vi.fn(),
}));

import { POST } from "@/app/api/assistant/route";

function request() {
  return new Request("https://app.test/api/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "request-1",
    },
    body: JSON.stringify({ action: "hint-card", card_id: crypto.randomUUID() }),
  });
}

function ownedCardClient() {
  const card = {
    id: crypto.randomUUID(),
    type: "basic",
    front: "Question",
    back: "Answer",
    cloze_text: null,
    extra: null,
  };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => ({ data: card, error: null }));
  return { from: vi.fn(() => query) };
}

describe("POST /api/assistant credit enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.DEEPHAUS_USE_MOCK_LLM;
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    createClient.mockResolvedValue(ownedCardClient());
    reserveAiCredits.mockResolvedValue({ id: "credit-1" });
    settleAiCredits.mockResolvedValue({ id: "credit-1", status: "settled" });
    releaseAiCredits.mockResolvedValue({ id: "credit-1", status: "released" });
    hintForCard.mockResolvedValue("A useful hint");
  });

  it("charges one credit for a successful short action", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(reserveAiCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        idempotencyKey: "assistant:hint-card:user-1:request-1",
        reservedCredits: 1,
      }),
    );
    expect(hintForCard).toHaveBeenCalledOnce();
    expect(settleAiCredits).toHaveBeenCalledWith(
      expect.objectContaining({ chargedCredits: 1 }),
    );
    expect(releaseAiCredits).not.toHaveBeenCalled();
  });

  it("returns structured 402 before calling the vendor", async () => {
    reserveAiCredits.mockRejectedValue({
      code: "AI_CREDITS_EXHAUSTED",
      allowance: 250,
      consumed: 250,
      required: 1,
    });

    const response = await POST(request());

    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      code: "AI_CREDITS_EXHAUSTED",
      allowance: 250,
      consumed: 250,
      required: 1,
    });
    expect(hintForCard).not.toHaveBeenCalled();
  });

  it("releases the reservation when the vendor fails", async () => {
    hintForCard.mockRejectedValue(new Error("vendor unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    const idempotencyKey = reserveAiCredits.mock.calls[0][0].idempotencyKey;
    expect(releaseAiCredits).toHaveBeenCalledWith({
      userId: "user-1",
      idempotencyKey,
    });
    expect(settleAiCredits).not.toHaveBeenCalled();
  });
});
