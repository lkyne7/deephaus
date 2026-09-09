import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const {
  createClient,
  editCardsWithInstruction,
  createMockEditedCards,
  releaseAiCredits,
  requireUser,
  reserveAiCredits,
  settleAiCredits,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  editCardsWithInstruction: vi.fn(),
  createMockEditedCards: vi.fn(),
  releaseAiCredits: vi.fn(),
  requireUser: vi.fn(),
  reserveAiCredits: vi.fn(),
  settleAiCredits: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/credits/service", () => ({
  creditIdempotencyKey: (userId: string, operation: string, requestKey: string | null) =>
    `${operation}:${userId}:${requestKey}`,
  reserveAiCredits,
  settleAiCredits,
  releaseAiCredits,
  isAiCreditsExhaustedError: (error: { code?: string }) => error?.code === "AI_CREDITS_EXHAUSTED",
  aiCreditsExhaustedResponse: (error: { code: string }) =>
    Response.json({ error: "AI credits exhausted.", code: error.code }, { status: 402 }),
}));
vi.mock("@deephaus/llm", async () => {
  const actual = await vi.importActual<typeof import("@deephaus/llm")>("@deephaus/llm");
  return {
    ...actual,
    editCardsWithInstruction,
    createMockEditedCards,
  };
});

import { POST } from "@/app/api/cards/assistant-edit/route";

const DECK_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user-1";

type CardFixture = {
  id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
};

function card(overrides: Partial<CardFixture> = {}): CardFixture {
  return {
    id: crypto.randomUUID(),
    type: "basic",
    front: "What is the capital of France?",
    back: "Paris is the capital city of France, located on the Seine.",
    cloze_text: null,
    extra: null,
    tags: ["Geography"],
    ...overrides,
  };
}

function request(body: Record<string, unknown>) {
  return new Request("https://app.test/api/cards/assistant-edit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "request-1" },
    body: JSON.stringify(body),
  });
}

/**
 * Minimal Supabase stub: `projects` resolves the owned deck, `cards` resolves
 * the fixture list on read and echoes the update payload on write.
 */
function supabaseStub(cards: CardFixture[], opts: { deckOwned?: boolean } = {}) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

  function projectsQuery() {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq"]) q[m] = vi.fn(() => q);
    q.single = vi.fn(async () => ({
      data: opts.deckOwned === false ? null : { id: DECK_ID, name: "Deck", deck_name: "Vertigo" },
      error: null,
    }));
    return q;
  }

  function cardsQuery() {
    let mode: "read" | "update" = "read";
    let pendingPatch: Record<string, unknown> = {};
    let pendingId: string | null = null;
    const q: Record<string, unknown> = {};
    for (const m of ["select", "order", "limit", "in"]) {
      q[m] = vi.fn(() => q);
    }
    q.eq = vi.fn((column: string, value: string) => {
      if (mode === "update" && column === "id") pendingId = value;
      return q;
    });
    q.update = vi.fn((patch: Record<string, unknown>) => {
      mode = "update";
      pendingPatch = patch;
      return q;
    });
    q.single = vi.fn(async () => {
      const original = cards.find((c) => c.id === pendingId);
      if (!original) return { data: null, error: { message: "not found" } };
      updates.push({ id: pendingId!, patch: pendingPatch });
      return { data: { ...original, ...pendingPatch }, error: null };
    });
    // Awaiting the read query resolves the fixture rows.
    q.then = (resolve: (v: unknown) => void) => resolve({ data: cards, error: null });
    return q;
  }

  return {
    updates,
    client: {
      from: vi.fn((table: string) => (table === "projects" ? projectsQuery() : cardsQuery())),
    },
  };
}

describe("POST /api/cards/assistant-edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.DEEPHAUS_USE_MOCK_LLM;
    requireUser.mockResolvedValue({ user: { id: USER_ID }, response: null });
    reserveAiCredits.mockResolvedValue({ id: "credit-1" });
    settleAiCredits.mockResolvedValue({ id: "credit-1", status: "settled" });
    releaseAiCredits.mockResolvedValue({ id: "credit-1", status: "released" });
  });

  it("reserves credits by card count, applies sanitized edits, and settles", async () => {
    const cards = Array.from({ length: 12 }, () => card());
    const stub = supabaseStub(cards);
    createClient.mockResolvedValue(stub.client);
    editCardsWithInstruction.mockResolvedValue({
      summary: "Shortened two answers.",
      tokenUsage: 100,
      cards: [
        { id: cards[0]!.id, front: cards[0]!.front, back: "Paris.", cloze_text: null, extra: null, tags: null },
        // No-op patch → skipped.
        { id: cards[1]!.id, front: cards[1]!.front, back: cards[1]!.back, cloze_text: null, extra: null, tags: null },
        // Unknown id → ignored.
        { id: crypto.randomUUID(), front: "x", back: "y", cloze_text: null, extra: null, tags: null },
      ],
    });

    const response = await POST(
      request({ deck_id: DECK_ID, instruction: "Make answers more concise" }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.scope).toBe(12);
    expect(json.updated).toHaveLength(1);
    expect(json.updated[0]).toMatchObject({ id: cards[0]!.id, back: "Paris." });
    expect(json.skipped).toBe(11);
    expect(json.summary).toBe("Shortened two answers.");

    expect(reserveAiCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        idempotencyKey: `assistant:edit-cards:${USER_ID}:request-1`,
        reservedCredits: 2,
        resourceId: DECK_ID,
      }),
    );
    expect(settleAiCredits).toHaveBeenCalledWith(expect.objectContaining({ chargedCredits: 2 }));
    expect(releaseAiCredits).not.toHaveBeenCalled();
    expect(stub.updates).toHaveLength(1);
    expect(stub.updates[0]!.patch).toMatchObject({ back: "Paris.", user_edited: true });
  });

  it("returns 402 before calling the model when credits are exhausted", async () => {
    createClient.mockResolvedValue(supabaseStub([card()]).client);
    reserveAiCredits.mockRejectedValue({ code: "AI_CREDITS_EXHAUSTED" });

    const response = await POST(request({ deck_id: DECK_ID, instruction: "Fix typos" }));

    expect(response.status).toBe(402);
    expect(editCardsWithInstruction).not.toHaveBeenCalled();
  });

  it("releases the reservation when the model call fails", async () => {
    createClient.mockResolvedValue(supabaseStub([card()]).client);
    editCardsWithInstruction.mockRejectedValue(new Error("vendor unavailable"));

    const response = await POST(request({ deck_id: DECK_ID, instruction: "Fix typos" }));

    expect(response.status).toBe(500);
    expect(releaseAiCredits).toHaveBeenCalledWith({
      userId: USER_ID,
      idempotencyKey: `assistant:edit-cards:${USER_ID}:request-1`,
    });
    expect(settleAiCredits).not.toHaveBeenCalled();
  });

  it("rejects decks the user does not own", async () => {
    createClient.mockResolvedValue(supabaseStub([card()], { deckOwned: false }).client);

    const response = await POST(request({ deck_id: DECK_ID, instruction: "Fix typos" }));

    expect(response.status).toBe(404);
    expect(reserveAiCredits).not.toHaveBeenCalled();
  });

  it("uses the mock path without touching credits when no API key is set", async () => {
    delete process.env.OPENAI_API_KEY;
    const cards = [card()];
    createClient.mockResolvedValue(supabaseStub(cards).client);
    createMockEditedCards.mockReturnValue({
      summary: "mock",
      tokenUsage: 0,
      cards: [{ id: cards[0]!.id, front: null, back: null, cloze_text: null, extra: null, tags: ["Geography", "AI edited"] }],
    });

    const response = await POST(request({ deck_id: DECK_ID, instruction: "Tag these" }));

    expect(response.status).toBe(200);
    expect(reserveAiCredits).not.toHaveBeenCalled();
    expect(editCardsWithInstruction).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json.updated[0].tags).toEqual(["Geography", "AI edited"]);
  });

  it("rejects invalid bodies", async () => {
    createClient.mockResolvedValue(supabaseStub([card()]).client);
    const response = await POST(request({ deck_id: "nope", instruction: "" }));
    expect(response.status).toBe(400);
  });
});
