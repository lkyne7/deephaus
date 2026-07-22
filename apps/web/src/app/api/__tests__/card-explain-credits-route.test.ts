import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const {
  createClient,
  explainCard,
  requireUser,
  reserveAiCredits,
  settleAiCredits,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  explainCard: vi.fn(),
  requireUser: vi.fn(),
  reserveAiCredits: vi.fn(),
  settleAiCredits: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@deephaus/llm", () => ({
  createMockExplanation: vi.fn(),
  explainCard,
}));
vi.mock("@/lib/credits/service", () => ({
  creditIdempotencyKey: (
    userId: string,
    operation: string,
    requestKey: string | null,
  ) => `${operation}:${userId}:${requestKey}`,
  reserveAiCredits,
  settleAiCredits,
  releaseAiCredits: vi.fn(),
  isAiCreditsExhaustedError: () => false,
  aiCreditsExhaustedResponse: vi.fn(),
}));

import { POST } from "@/app/api/cards/[id]/explain/route";

const CARD_ID = "11111111-1111-4111-8111-111111111111";

function request() {
  return new Request(`https://app.test/api/cards/${CARD_ID}/explain`, {
    method: "POST",
    headers: { "Idempotency-Key": "explain-request-1" },
  });
}

describe("POST /api/cards/[id]/explain idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.DEEPHAUS_USE_MOCK_LLM;
    requireUser.mockResolvedValue({
      user: { id: "user-1" },
      response: null,
    });
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.single = vi.fn(async () => ({
      data: {
        id: CARD_ID,
        type: "basic",
        front: "Question",
        back: "Answer",
        cloze_text: null,
        extra: null,
      },
      error: null,
    }));
    createClient.mockResolvedValue({ from: vi.fn(() => query) });
    reserveAiCredits.mockResolvedValue({ id: "credit-1" });
    settleAiCredits.mockResolvedValue({ id: "credit-1", status: "settled" });
    explainCard.mockResolvedValue("Explanation");
  });

  it("uses the same user-bound operation key on retries", async () => {
    await POST(request(), { params: Promise.resolve({ id: CARD_ID }) });
    await POST(request(), { params: Promise.resolve({ id: CARD_ID }) });

    const expected = `card-explain:${CARD_ID}:user-1:explain-request-1`;
    expect(reserveAiCredits).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ idempotencyKey: expected }),
    );
    expect(reserveAiCredits).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: expected }),
    );
  });
});
