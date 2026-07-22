import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const {
  createClient,
  embedQuery,
  releaseAiCredits,
  requireUser,
  reserveAiCredits,
  settleAiCredits,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  embedQuery: vi.fn(),
  releaseAiCredits: vi.fn(),
  requireUser: vi.fn(),
  reserveAiCredits: vi.fn(),
  settleAiCredits: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@deephaus/llm", () => ({ embedQuery }));
vi.mock("@/lib/credits/service", () => ({
  creditIdempotencyKey: (
    userId: string,
    operation: string,
    requestKey: string | null,
  ) => `${operation}:${userId}:${requestKey}`,
  reserveAiCredits,
  settleAiCredits,
  releaseAiCredits,
  isAiCreditsExhaustedError: () => false,
  aiCreditsExhaustedResponse: vi.fn(),
}));

import { POST } from "@/app/api/sources/search/route";

function request() {
  return new Request("https://app.test/api/sources/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": "search-request-1",
    },
    body: JSON.stringify({ query: "mitochondrial membrane" }),
  });
}

describe("POST /api/sources/search credit lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.DEEPHAUS_USE_MOCK_LLM;
    requireUser.mockResolvedValue({
      user: { id: "user-1" },
      response: null,
    });
    createClient.mockResolvedValue({});
    reserveAiCredits.mockResolvedValue({ id: "credit-1" });
    releaseAiCredits.mockResolvedValue({ id: "credit-1", status: "released" });
    embedQuery.mockResolvedValue(null);
  });

  it("releases a stable request reservation when embedding returns null", async () => {
    const first = await POST(request());
    const second = await POST(request());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(reserveAiCredits).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        idempotencyKey: "source-search:user-1:search-request-1",
      }),
    );
    expect(reserveAiCredits).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotencyKey: "source-search:user-1:search-request-1",
      }),
    );
    expect(releaseAiCredits).toHaveBeenCalledTimes(2);
    expect(settleAiCredits).not.toHaveBeenCalled();
  });
});
