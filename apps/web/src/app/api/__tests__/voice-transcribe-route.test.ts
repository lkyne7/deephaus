import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const { requireUser, transcribeDictation } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  transcribeDictation: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@deephaus/llm", () => ({ transcribeDictation }));

import { POST } from "@/app/api/voice/transcribe/route";

function upload(file: File | null) {
  const form = new FormData();
  if (file) form.append("file", file);
  return POST(new Request("https://app.test/api/voice/transcribe", { method: "POST", body: form }));
}

describe("POST /api/voice/transcribe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    transcribeDictation.mockResolvedValue({ text: "Make ten cards on mitosis." });
  });

  it("returns the transcript for a browser recording", async () => {
    const response = await upload(new File([new Uint8Array(64)], "clip.webm", { type: "audio/webm" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "Make ten cards on mitosis." });
    expect(requireUser).toHaveBeenCalledWith({ rateLimit: "costly" });
    expect(transcribeDictation.mock.calls[0][1]).toBe("voice-prompt.webm");
  });

  it("accepts a native recording with no MIME type by its extension", async () => {
    const response = await upload(new File([new Uint8Array(64)], "voice-prompt.m4a"));
    expect(response.status).toBe(200);
    expect(transcribeDictation.mock.calls[0][1]).toBe("voice-prompt.m4a");
  });

  it("stops when the user isn't signed in", async () => {
    requireUser.mockResolvedValue({ user: null, response: new Response(null, { status: 401 }) });
    const response = await upload(new File([new Uint8Array(64)], "clip.webm", { type: "audio/webm" }));
    expect(response.status).toBe(401);
    expect(transcribeDictation).not.toHaveBeenCalled();
  });

  it("rejects a missing, empty, non-audio, or oversized upload", async () => {
    expect((await upload(null)).status).toBe(400);
    expect((await upload(new File([], "clip.webm", { type: "audio/webm" }))).status).toBe(400);
    expect((await upload(new File([new Uint8Array(64)], "notes.pdf", { type: "application/pdf" }))).status).toBe(415);
    const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "clip.webm", { type: "audio/webm" });
    expect((await upload(big)).status).toBe(413);
    expect(transcribeDictation).not.toHaveBeenCalled();
  });

  it("reports silence and provider failures without leaking details", async () => {
    transcribeDictation.mockResolvedValueOnce({ text: "" });
    const silent = await upload(new File([new Uint8Array(64)], "clip.webm", { type: "audio/webm" }));
    expect(silent.status).toBe(422);

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    transcribeDictation.mockRejectedValueOnce(new Error("sk-secret upstream failure"));
    const failed = await upload(new File([new Uint8Array(64)], "clip.webm", { type: "audio/webm" }));
    expect(failed.status).toBe(502);
    expect(JSON.stringify(await failed.json())).not.toContain("sk-secret");
  });
});
