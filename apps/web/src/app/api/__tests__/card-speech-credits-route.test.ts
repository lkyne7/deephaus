import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const {
  createClient,
  synthesizeSpeech,
  requireUser,
  reserveAiCredits,
  settleAiCredits,
  releaseAiCredits,
  upload,
} = vi.hoisted(() => ({
  createClient: vi.fn(),
  synthesizeSpeech: vi.fn(),
  requireUser: vi.fn(),
  reserveAiCredits: vi.fn(),
  settleAiCredits: vi.fn(),
  releaseAiCredits: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@deephaus/llm", () => ({
  synthesizeSpeech,
  speechInstructions: (language?: string) => `instructions:${language ?? ""}`,
}));
vi.mock("@/lib/credits/service", () => ({
  creditIdempotencyKey: (userId: string, operation: string, requestKey: string | null) =>
    `${operation}:${userId}:${requestKey}`,
  reserveAiCredits,
  settleAiCredits,
  releaseAiCredits,
  isAiCreditsExhaustedError: (error: unknown) => error instanceof Error && error.message === "exhausted",
  aiCreditsExhaustedResponse: () => new Response(JSON.stringify({ error: "exhausted" }), { status: 402 }),
}));

import { POST, speechCredits } from "@/app/api/cards/[id]/speech/route";

const CARD_ID = "11111111-1111-4111-8111-111111111111";

function request(body: Record<string, unknown>) {
  return new Request(`https://app.test/api/cards/${CARD_ID}/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": "speech-request-1" },
    body: JSON.stringify(body),
  });
}

async function call(body: Record<string, unknown>) {
  return POST(request(body), { params: Promise.resolve({ id: CARD_ID }) });
}

describe("POST /api/cards/[id]/speech", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.DEEPHAUS_USE_MOCK_LLM;
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.single = vi.fn(async () => ({ data: { id: CARD_ID }, error: null }));
    upload.mockResolvedValue({ error: null });
    createClient.mockResolvedValue({
      from: vi.fn(() => query),
      storage: {
        from: vi.fn(() => ({
          upload,
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/card-media/${path}` } }),
        })),
      },
    });
    reserveAiCredits.mockResolvedValue({ id: "credit-1" });
    settleAiCredits.mockResolvedValue({ id: "credit-1", status: "settled" });
    synthesizeSpeech.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/mpeg" });
  });

  it("charges one credit per started thousand characters", () => {
    expect(speechCredits("a")).toBe(1);
    expect(speechCredits("a".repeat(1000))).toBe(1);
    expect(speechCredits("a".repeat(1001))).toBe(2);
  });

  it("reserves, synthesizes the cleaned text, stores the clip and settles", async () => {
    const res = await call({ text: "Say **bonjour** {{c1::madame::hint}} <audio src=\"https://x/y.mp3\"></audio>", voice: "nova", language: "French" });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toMatch(/card-media\/user-1\/11111111-1111-4111-8111-111111111111\/\d+-speech\.mp3$/);
    expect(body).toMatchObject({ title: "Pronunciation", characters: "Say bonjour madame".length, credits: 1 });

    expect(reserveAiCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        idempotencyKey: `card-tts:${CARD_ID}:user-1:speech-request-1`,
        action: "card-tts",
        reservedCredits: 1,
        resourceId: CARD_ID,
      }),
    );
    expect(synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Say bonjour madame", voice: "nova", instructions: "instructions:French", apiKey: "test-key", mock: false }),
    );
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/-speech\.mp3$/), expect.anything(), expect.objectContaining({ contentType: "audio/mpeg" }));
    expect(settleAiCredits).toHaveBeenCalledWith({ userId: "user-1", idempotencyKey: `card-tts:${CARD_ID}:user-1:speech-request-1`, chargedCredits: 1 });
  });

  it("falls back to the default voice and skips credits when mocked", async () => {
    process.env.DEEPHAUS_USE_MOCK_LLM = "true";
    const res = await call({ text: "Hello", voice: "not-a-voice" });
    expect(res.status).toBe(201);
    expect((await res.json()).credits).toBe(0);
    expect(reserveAiCredits).not.toHaveBeenCalled();
    expect(synthesizeSpeech).toHaveBeenCalledWith(expect.objectContaining({ voice: "alloy", mock: true }));
  });

  it("releases the reservation when synthesis fails, and reports exhausted credits", async () => {
    synthesizeSpeech.mockRejectedValueOnce(new Error("boom"));
    expect((await call({ text: "Hello" })).status).toBe(500);
    expect(releaseAiCredits).toHaveBeenCalledWith({ userId: "user-1", idempotencyKey: `card-tts:${CARD_ID}:user-1:speech-request-1` });

    reserveAiCredits.mockRejectedValueOnce(new Error("exhausted"));
    expect((await call({ text: "Hello" })).status).toBe(402);
  });

  it("rejects empty and over-long text", async () => {
    expect((await call({ text: "<img src=\"https://x/y.png\">" })).status).toBe(400);
    expect((await call({ text: "a".repeat(5000) })).status).toBe(400);
    expect(reserveAiCredits).not.toHaveBeenCalled();
  });
});
