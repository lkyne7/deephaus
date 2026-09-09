import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const {
  createClient,
  regenerateCard,
  createMockRegeneratedCard,
  releaseAiCredits,
  requireUser,
  reserveAiCredits,
  settleAiCredits,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  regenerateCard: vi.fn(),
  createMockRegeneratedCard: vi.fn(),
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
  return { ...actual, regenerateCard, createMockRegeneratedCard };
});

import { POST } from "@/app/api/cards/[id]/regenerate/route";

const CARD_ID = "33333333-3333-4333-8333-333333333333";
const CHUNK_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "user-1";

type CardRow = {
  id: string;
  type: string;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
  source_chunk_id: string | null;
  source_quote: string | null;
};

function row(overrides: Partial<CardRow> = {}): CardRow {
  return {
    id: CARD_ID,
    type: "basic",
    front: "What is the powerhouse of the cell?",
    back: "The mitochondrion",
    cloze_text: null,
    extra: null,
    tags: ["Biology"],
    source_chunk_id: CHUNK_ID,
    source_quote: "Mitochondria generate most of the cell's ATP.",
    ...overrides,
  };
}

function call() {
  const request = new Request(`https://app.test/api/cards/${CARD_ID}/regenerate`, {
    method: "POST",
    headers: { "Idempotency-Key": "request-1" },
  });
  return POST(request, { params: Promise.resolve({ id: CARD_ID }) });
}

/**
 * Supabase stub: `cards` read resolves the row with project settings, the
 * `source_chunks` read resolves chunk text, and `cards` update echoes the patch.
 */
function supabaseStub(card: CardRow | null, opts: { chunkText?: string | null; clozeHints?: boolean } = {}) {
  const updates: Array<Record<string, unknown>> = [];

  function cardsQuery() {
    let mode: "read" | "update" = "read";
    let patch: Record<string, unknown> = {};
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.update = vi.fn((p: Record<string, unknown>) => {
      mode = "update";
      patch = p;
      return q;
    });
    q.single = vi.fn(async () => {
      if (mode === "update") {
        updates.push(patch);
        return {
          data: { ...card, ...patch, updated_at: patch.updated_at },
          error: null,
        };
      }
      return card
        ? {
            data: {
              ...card,
              generation_jobs: {
                sources: {
                  projects: {
                    user_id: USER_ID,
                    name: "Deck",
                    deck_name: "Cell bio",
                    settings: { clozeHints: opts.clozeHints ?? false },
                  },
                },
              },
            },
            error: null,
          }
        : { data: null, error: { message: "not found" } };
    });
    return q;
  }

  function chunksQuery() {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.eq = vi.fn(() => q);
    q.maybeSingle = vi.fn(async () => ({
      data: opts.chunkText === undefined ? { content: "Chunk text about mitochondria." } : opts.chunkText ? { content: opts.chunkText } : null,
      error: null,
    }));
    return q;
  }

  return {
    updates,
    client: {
      from: vi.fn((table: string) => (table === "source_chunks" ? chunksQuery() : cardsQuery())),
    },
  };
}

describe("POST /api/cards/[id]/regenerate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.DEEPHAUS_USE_MOCK_LLM;
    requireUser.mockResolvedValue({ user: { id: USER_ID }, response: null });
    reserveAiCredits.mockResolvedValue({ id: "credit-1" });
    settleAiCredits.mockResolvedValue({ id: "credit-1", status: "settled" });
    releaseAiCredits.mockResolvedValue({ id: "credit-1", status: "released" });
  });

  it("grounds the rewrite in the source chunk, saves the new fields, and settles one credit", async () => {
    const stub = supabaseStub(row());
    createClient.mockResolvedValue(stub.client);
    regenerateCard.mockResolvedValue({
      card: {
        front: "Which organelle produces most of a cell's ATP?",
        back: "The mitochondrion",
        cloze_text: null,
        extra: null,
      },
      tokenUsage: 200,
    });

    const res = await call();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; type: string; front: string; back: string };
    expect(json.id).toBe(CARD_ID);
    expect(json.type).toBe("basic");
    expect(json.front).toBe("Which organelle produces most of a cell's ATP?");

    expect(regenerateCard).toHaveBeenCalledWith(
      expect.objectContaining({
        card: expect.objectContaining({ type: "basic", front: "What is the powerhouse of the cell?" }),
        sourceQuote: "Mitochondria generate most of the cell's ATP.",
        sourceContext: "Chunk text about mitochondria.",
        deckName: "Cell bio",
        clozeHints: false,
      }),
      expect.objectContaining({ apiKey: "test-key" }),
    );
    expect(reserveAiCredits).toHaveBeenCalledWith(
      expect.objectContaining({ action: "cards:regenerate", reservedCredits: 1 }),
    );
    expect(settleAiCredits).toHaveBeenCalledWith(expect.objectContaining({ chargedCredits: 1 }));
    expect(stub.updates).toHaveLength(1);
    expect(stub.updates[0]).toMatchObject({
      front: "Which organelle produces most of a cell's ATP?",
      back: "The mitochondrion",
      cloze_text: null,
      extra: null,
      user_edited: true,
    });
  });

  it("keeps cloze cards as cloze and honours the deck's cloze-hint setting", async () => {
    const stub = supabaseStub(
      row({
        type: "cloze",
        front: null,
        back: null,
        cloze_text: "The {{c1::mitochondrion}} makes ATP.",
        source_chunk_id: null,
      }),
      { clozeHints: true },
    );
    createClient.mockResolvedValue(stub.client);
    regenerateCard.mockResolvedValue({
      card: {
        front: null,
        back: null,
        cloze_text: "Most cellular ATP is produced by the {{c1::mitochondrion::organelle}}.",
        extra: null,
      },
      tokenUsage: 90,
    });

    const res = await call();
    expect(res.status).toBe(200);
    expect(regenerateCard).toHaveBeenCalledWith(
      expect.objectContaining({ clozeHints: true, sourceContext: null }),
      expect.anything(),
    );
    expect(stub.updates[0]).toMatchObject({
      cloze_text: "Most cellular ATP is produced by the {{c1::mitochondrion::organelle}}.",
      front: null,
      back: null,
    });
  });

  it("returns 422 and does not save when the model output is unusable", async () => {
    const stub = supabaseStub(row());
    createClient.mockResolvedValue(stub.client);
    // Missing answer → sanitizer rejects.
    regenerateCard.mockResolvedValue({
      card: { front: "New question?", back: "", cloze_text: null, extra: null },
      tokenUsage: 10,
    });

    const res = await call();
    expect(res.status).toBe(422);
    expect(stub.updates).toHaveLength(0);
    // The model did run, so the credit is legitimately settled.
    expect(settleAiCredits).toHaveBeenCalledTimes(1);
  });

  it("releases the reservation when the model call fails", async () => {
    const stub = supabaseStub(row());
    createClient.mockResolvedValue(stub.client);
    regenerateCard.mockRejectedValue(new Error("boom"));

    const res = await call();
    expect(res.status).toBe(500);
    expect(releaseAiCredits).toHaveBeenCalledTimes(1);
    expect(settleAiCredits).not.toHaveBeenCalled();
    expect(stub.updates).toHaveLength(0);
  });

  it("rejects image-occlusion cards and unknown cards", async () => {
    createClient.mockResolvedValue(supabaseStub(row({ type: "image-occlusion" })).client);
    expect((await call()).status).toBe(400);

    createClient.mockResolvedValue(supabaseStub(null).client);
    expect((await call()).status).toBe(404);
    expect(reserveAiCredits).not.toHaveBeenCalled();
  });

  it("uses the offline mock without credits when no API key is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    const stub = supabaseStub(row());
    createClient.mockResolvedValue(stub.client);
    createMockRegeneratedCard.mockReturnValue({
      card: { front: "In your own words: what is the powerhouse of the cell?", back: "The mitochondrion", cloze_text: null, extra: null },
      tokenUsage: 0,
    });

    const res = await call();
    expect(res.status).toBe(200);
    expect(createMockRegeneratedCard).toHaveBeenCalledTimes(1);
    expect(regenerateCard).not.toHaveBeenCalled();
    expect(reserveAiCredits).not.toHaveBeenCalled();
    expect(stub.updates).toHaveLength(1);
  });
});
