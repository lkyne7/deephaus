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
  loadUserParams,
} = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  createServiceClient: vi.fn(),
  invalidateUserStudyCaches: vi.fn(),
  loadDeckSettings: vi.fn(),
  loadUserParams: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("@/lib/cache/invalidate", () => ({ invalidateUserStudyCaches }));
vi.mock("@/lib/fsrs/settings", () => ({ loadDeckSettings }));
vi.mock("@/lib/fsrs/scheduler", () => ({
  buildScheduler: () => ({
    next: () => ({
      card: {
        state: 2,
        due: new Date("2026-08-25T23:00:00.000Z"),
        scheduled_days: 1,
      },
      log: {
        state: 1,
        due: new Date("2026-08-24T23:00:00.000Z"),
        stability: 1,
        difficulty: 5,
        elapsed_days: 0,
        last_elapsed_days: 0,
        scheduled_days: 1,
        review: new Date("2026-08-24T23:00:00.000Z"),
      },
    }),
  }),
  cardToRowFields: () => ({
    due: "2026-08-25T23:00:00.000Z",
    stability: 1,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 1,
    learning_steps: 0,
    reps: 2,
    lapses: 0,
    state: 2,
    last_review: "2026-08-24T23:00:00.000Z",
  }),
  emptyCard: () => ({}),
  formatInterval: () => "1d",
  gradeToRating: () => 3,
  isValidGrade: (rating: number) => rating >= 1 && rating <= 4,
  loadUserParams,
  previewIntervals: () => ({
    again: "1m",
    hard: "6m",
    good: "1d",
    easy: "4d",
  }),
  resolveDeckParams: () => [],
  rowToCard: () => ({}),
}));

import { POST } from "@/app/api/cards/[id]/review/route";

function chain(result: unknown, terminal: "single" | "maybeSingle") {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query[terminal] = vi.fn(async () => ({ data: result, error: null }));
  return query;
}

function request(mutationId: string) {
  return new Request("https://app.test/api/cards/card-1/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rating: 3,
      cloze_ord: 0,
      client_mutation_id: mutationId,
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
    loadUserParams.mockResolvedValue([]);
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
      }),
    );
    expect(invalidateUserStudyCaches).toHaveBeenCalledWith("user-1");
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
