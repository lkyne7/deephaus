import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const {
  requireAuth,
  createServiceClient,
  invalidateUserStudyCaches,
  loadDeckSettings,
  loadUserWeights,
  loadReviewHistories,
  nextState,
  grade,
  previewIntervals,
} = vi.hoisted(() => {
  const nextState = {
    due: "2026-08-25T23:00:00.000Z",
    stability: 1,
    stability_fast: 0.4,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 1,
    learning_steps: 0,
    reps: 2,
    lapses: 0,
    state: 2,
    last_review: "2026-08-24T23:00:00.000Z",
    fsrs_version: 7,
  };
  const previewIntervals = vi.fn(() => ({
    again: "1m",
    hard: "6m",
    good: "1d",
    easy: "4d",
  }));
  const grade = vi.fn(() => ({
    next: nextState,
    log: {
      rating: 3,
      state: 1,
      due: "2026-08-24T23:00:00.000Z",
      stability: 1,
      difficulty: 5,
      elapsed_days: 0,
      last_elapsed_days: 0,
      scheduled_days: 1,
      review: "2026-08-24T23:00:00.000Z",
    },
    model: 7,
    intervalDays: 1,
  }));
  return {
    requireAuth: vi.fn(),
    createServiceClient: vi.fn(),
    invalidateUserStudyCaches: vi.fn(),
    loadDeckSettings: vi.fn(),
    loadUserWeights: vi.fn(),
    loadReviewHistories: vi.fn(),
    nextState,
    grade,
    previewIntervals,
  };
});

vi.mock("@/lib/auth", () => ({ requireAuth }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("@/lib/cache/invalidate", () => ({ invalidateUserStudyCaches }));
vi.mock("@/lib/fsrs/settings", () => ({ loadDeckSettings }));
vi.mock("@/lib/fsrs/scheduler", () => ({
  buildScheduler: () => ({ grade, previewIntervals }),
  formatInterval: () => "1d",
  gradeToRating: () => 3,
  isValidGrade: (rating: number) => rating >= 1 && rating <= 4,
  loadReviewHistories,
  loadUserWeights,
  resolveWeights: () => ({}),
  reviewHistoryKey: (cardId: string, clozeOrd: number) => `${cardId}:${clozeOrd}`,
}));

import { POST } from "@/app/api/cards/[id]/review/route";

function chain(result: unknown, terminal: "single" | "maybeSingle") {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query[terminal] = vi.fn(async () => ({ data: result, error: null }));
  return query;
}

function request(mutationId: string, extra: Record<string, unknown> = {}) {
  return new Request("https://app.test/api/cards/card-1/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rating: 3,
      cloze_ord: 0,
      client_mutation_id: mutationId,
      ...extra,
    }),
  });
}

describe("POST /api/cards/[id]/review", () => {
  const mutationId = "11111111-1111-4111-8111-111111111111";
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    const cardQuery = chain(
      {
        id: "card-1",
        generation_jobs: {
          sources: {
            projects: { id: "deck-1", user_id: "user-1", settings: {} },
          },
        },
      },
      "single",
    );
    const reviewQuery = chain(
      {
        due: "2026-08-24T23:00:00.000Z",
        stability: 1,
        difficulty: 5,
        elapsed_days: 0,
        scheduled_days: 1,
        reps: 1,
        lapses: 0,
        state: 1,
        last_review: "2026-08-23T23:00:00.000Z",
        learning_steps: 0,
        version: 7,
      },
      "maybeSingle",
    );
    const supabase = {
      from: vi.fn((table: string) =>
        table === "cards" ? cardQuery : reviewQuery,
      ),
    };
    requireAuth.mockResolvedValue({
      user: { id: "user-1" },
      supabase,
      response: null,
    });
    loadDeckSettings.mockResolvedValue({
      fsrsParams: [],
      desiredRetention: 0.9,
    });
    loadUserWeights.mockResolvedValue({});
    loadReviewHistories.mockResolvedValue(
      new Map([
        [
          "card-1:0",
          [{ rating: 3, state: 0, review: "2026-08-23T23:00:00.000Z" }],
        ],
      ]),
    );
    createServiceClient.mockReturnValue({ rpc });
    rpc.mockResolvedValue({ data: { stored: true }, error: null });
  });

  it("commits state and history through one idempotent RPC", async () => {
    const response = await POST(request(mutationId), {
      params: Promise.resolve({ id: "card-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ stored: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      "apply_card_review",
      expect.objectContaining({
        p_user_id: "user-1",
        p_card_id: "card-1",
        p_expected_version: 7,
        p_mutation_id: mutationId,
        // The FSRS-7 memory state travels with the review.
        p_review: expect.objectContaining({
          stability_fast: 0.4,
          fsrs_version: 7,
        }),
        // A request that says nothing about where it was answered is study.
        p_log: expect.objectContaining({
          context: "study",
          exam_id: null,
          response_ms: null,
        }),
      }),
    );
    // The card's recorded history reaches the scheduler, and the follow-up
    // preview sees this review appended to it.
    expect(grade).toHaveBeenCalledWith(
      expect.objectContaining({
        cardKey: "card-1:0",
        rating: 3,
        history: [{ rating: 3, state: 0, review: "2026-08-23T23:00:00.000Z" }],
      }),
    );
    expect(previewIntervals).toHaveBeenCalledWith(
      expect.objectContaining({
        review: nextState,
        history: [
          { rating: 3, state: 0, review: "2026-08-23T23:00:00.000Z" },
          { rating: 3, state: 1, review: "2026-08-24T23:00:00.000Z" },
        ],
      }),
    );
    expect(invalidateUserStudyCaches).toHaveBeenCalledWith("user-1");
  });

  it("records where the card was answered and how long it took", async () => {
    const examId = "22222222-2222-4222-8222-222222222222";
    const response = await POST(
      request(mutationId, { context: "exam", exam_id: examId, response_ms: 4200 }),
      { params: Promise.resolve({ id: "card-1" }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "apply_card_review",
      expect.objectContaining({
        p_log: expect.objectContaining({
          context: "exam",
          exam_id: examId,
          response_ms: 4200,
        }),
      }),
    );
  });

  it("saves the review without a timing it cannot use", async () => {
    const response = await POST(request(mutationId, { response_ms: 3_600_001 }), {
      params: Promise.resolve({ id: "card-1" }),
    });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "apply_card_review",
      expect.objectContaining({
        p_log: expect.objectContaining({ response_ms: null }),
      }),
    );
  });

  it("rejects a context it does not know", async () => {
    const response = await POST(request(mutationId, { context: "quiz" }), {
      params: Promise.resolve({ id: "card-1" }),
    });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a stale review version to a retryable conflict", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "40001", message: "Card review changed" },
    });

    const response = await POST(request(mutationId), {
      params: Promise.resolve({ id: "card-1" }),
    });

    expect(response.status).toBe(409);
    expect(invalidateUserStudyCaches).not.toHaveBeenCalled();
  });
});
