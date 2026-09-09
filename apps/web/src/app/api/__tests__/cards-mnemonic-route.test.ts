import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const {
  createClient,
  generateCardMnemonic,
  createMockCardMnemonic,
  releaseAiCredits,
  requireUser,
  reserveAiCredits,
  settleAiCredits,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  generateCardMnemonic: vi.fn(),
  createMockCardMnemonic: vi.fn(),
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
  return { ...actual, generateCardMnemonic, createMockCardMnemonic };
});

import { POST } from "@/app/api/cards/[id]/mnemonic/route";

const CARD_ID = "22222222-2222-4222-8222-222222222222";
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
    front: "What are the causes of ARDS?",
    back: "Sepsis, pancreatitis, pneumonia, aspiration, uremia, trauma, amniotic fluid embolism, shock",
    cloze_text: null,
    extra: null,
    tags: ["Pulm"],
    source_chunk_id: null,
    source_quote: "ARDS causes: sepsis, pancreatitis, pneumonia, aspiration, uremia, trauma, AFE, shock.",
    ...overrides,
  };
}

const MNEMONIC_BASIC = {
  front: 'The causes of ARDS may be remembered with "SPPARTAS". What does each letter stand for?',
  back: "<u>**S**</u>epsis\n<u>**P**</u>ancreatitis, <u>**P**</u>neumonia\n<u>**A**</u>spiration\nu<u>**R**</u>emia\n<u>**T**</u>rauma\n<u>**A**</u>mniotic fluid embolism\n<u>**S**</u>hock",
  cloze_text: null,
  extra: null,
};

function call() {
  const request = new Request(`https://app.test/api/cards/${CARD_ID}/mnemonic`, {
    method: "POST",
    headers: { "Idempotency-Key": "request-1" },
  });
  return POST(request, { params: Promise.resolve({ id: CARD_ID }) });
}

/** Supabase stub: `cards` read resolves the row with project settings; update echoes the patch. */
function supabaseStub(card: CardRow | null, opts: { clozeHints?: boolean } = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const tables: string[] = [];

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
        return { data: { ...card, ...patch, updated_at: patch.updated_at }, error: null };
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
                    deck_name: "Pulmonology",
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

  return {
    updates,
    tables,
    client: {
      from: vi.fn((table: string) => {
        tables.push(table);
        return cardsQuery();
      }),
    },
  };
}

describe("POST /api/cards/[id]/mnemonic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.DEEPHAUS_USE_MOCK_LLM;
    requireUser.mockResolvedValue({ user: { id: USER_ID }, response: null });
    reserveAiCredits.mockResolvedValue({ id: "credit-1" });
    settleAiCredits.mockResolvedValue({ id: "credit-1", status: "settled" });
    releaseAiCredits.mockResolvedValue({ id: "credit-1", status: "released" });
  });

  it("rewrites a basic card in place as a mnemonic card and settles one credit", async () => {
    const stub = supabaseStub(row());
    createClient.mockResolvedValue(stub.client);
    generateCardMnemonic.mockResolvedValue({ card: MNEMONIC_BASIC, tokenUsage: 200 });

    const res = await call();
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      id: string;
      type: string;
      front: string;
      back: string;
      cloze_text: string | null;
      user_edited: boolean;
    };
    expect(json.id).toBe(CARD_ID);
    expect(json.type).toBe("basic");
    expect(json.front).toContain('"SPPARTAS"');
    expect(json.back).toContain("<u>**S**</u>epsis");
    expect(json.cloze_text).toBeNull();
    expect(json.user_edited).toBe(true);

    // The content fields are replaced on the same row; no separate field.
    expect(stub.updates).toHaveLength(1);
    expect(stub.updates[0]).toMatchObject({
      front: MNEMONIC_BASIC.front,
      back: MNEMONIC_BASIC.back,
      cloze_text: null,
      extra: null,
      user_edited: true,
    });
    expect(stub.updates[0]).not.toHaveProperty("mnemonic");
    // A mnemonic works from the card + evidence quote; the chunk is not fetched.
    expect(stub.tables).not.toContain("source_chunks");

    expect(reserveAiCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        action: "cards:mnemonic",
        reservedCredits: 1,
        metadata: expect.objectContaining({ card_id: CARD_ID, card_type: "basic" }),
      }),
    );
    expect(settleAiCredits).toHaveBeenCalledWith(expect.objectContaining({ chargedCredits: 1 }));
    expect(releaseAiCredits).not.toHaveBeenCalled();

    // Card, evidence quote and deck context reach the model.
    expect(generateCardMnemonic).toHaveBeenCalledWith(
      expect.objectContaining({
        card: expect.objectContaining({ type: "basic", back: row().back, tags: ["Pulm"] }),
        sourceQuote: row().source_quote,
        deckName: "Pulmonology",
        clozeHints: false,
      }),
      expect.objectContaining({ apiKey: "test-key" }),
    );
  });

  it("keeps cloze cards as cloze, forwards the hint setting, and repairs cloze syntax", async () => {
    const stub = supabaseStub(
      row({
        type: "cloze",
        front: null,
        back: null,
        cloze_text: "Causes of ARDS include {{c1::sepsis}}, {{c2::pancreatitis}} and {{c3::shock}}.",
      }),
      { clozeHints: true },
    );
    createClient.mockResolvedValue(stub.client);
    generateCardMnemonic.mockResolvedValue({
      card: {
        front: "should be ignored",
        back: null,
        cloze_text:
          'The causes of {{c2::acute respiratory distress::ARDS}} syndrome may be remembered with "{{c1::SPS}}":\n\n{{c1::<u>**S**</u>epsis}}\n{{c1:<u>**P**</u>ancreatitis}\n{{c1::<u>**S**</u>hock}}',
        extra: null,
      },
      tokenUsage: 150,
    });

    const res = await call();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { type: string; front: string | null; cloze_text: string };
    expect(json.type).toBe("cloze");
    expect(json.front).toBeNull();
    expect(json.cloze_text).toContain("{{c1::<u>**P**</u>ancreatitis}}");
    expect(json.cloze_text).toContain("{{c2::acute respiratory distress::ARDS}}");
    expect(generateCardMnemonic).toHaveBeenCalledWith(
      expect.objectContaining({ clozeHints: true, card: expect.objectContaining({ type: "cloze" }) }),
      expect.anything(),
    );
  });

  it("returns 422 and does not save when the model output is unusable", async () => {
    const stub = supabaseStub(row({ type: "cloze", front: null, back: null, cloze_text: "{{c1::x}}" }));
    createClient.mockResolvedValue(stub.client);
    generateCardMnemonic.mockResolvedValue({
      card: { front: null, back: null, cloze_text: "No deletions at all.", extra: null },
      tokenUsage: 10,
    });

    const res = await call();
    expect(res.status).toBe(422);
    expect(stub.updates).toHaveLength(0);
    // The credit is still consumed: the model call happened.
    expect(settleAiCredits).toHaveBeenCalledTimes(1);
  });

  it("releases the reservation and returns 500 when the model fails", async () => {
    const stub = supabaseStub(row());
    createClient.mockResolvedValue(stub.client);
    generateCardMnemonic.mockRejectedValue(new Error("upstream down"));

    const res = await call();
    expect(res.status).toBe(500);
    expect(releaseAiCredits).toHaveBeenCalledTimes(1);
    expect(settleAiCredits).not.toHaveBeenCalled();
    expect(stub.updates).toHaveLength(0);
  });

  it("returns 402 without calling the model when credits are exhausted", async () => {
    const stub = supabaseStub(row());
    createClient.mockResolvedValue(stub.client);
    reserveAiCredits.mockRejectedValue({ code: "AI_CREDITS_EXHAUSTED" });

    const res = await call();
    expect(res.status).toBe(402);
    expect(generateCardMnemonic).not.toHaveBeenCalled();
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
    createMockCardMnemonic.mockReturnValue({ card: MNEMONIC_BASIC, tokenUsage: 0 });

    const res = await call();
    expect(res.status).toBe(200);
    expect(createMockCardMnemonic).toHaveBeenCalledTimes(1);
    expect(generateCardMnemonic).not.toHaveBeenCalled();
    expect(reserveAiCredits).not.toHaveBeenCalled();
    expect(stub.updates[0]).toMatchObject({ back: MNEMONIC_BASIC.back });
  });
});
