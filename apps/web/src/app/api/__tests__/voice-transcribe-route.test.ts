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

  // The phone (apps/mobile/hooks/use-voice-prompt.ts) reads the recording with
  // fetch(file://…).blob(), which under expo/fetch has no type, so expo's
  // multipart encoder (expo/src/winter/fetch/convertFormData.ts) writes the part
  // with a filename and no Content-Type. The parser then reports text/plain.
  function phoneUpload(filename: string) {
    const boundary = "----ExpoFetchFormBoundaryAbCdEfGh12345678";
    const head = `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\n\r\n`;
    const tail = `\r\n--${boundary}--\r\n`;
    const audio = new Uint8Array([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]); // "ftypM4A "
    const body = new Uint8Array([...new TextEncoder().encode(head), ...audio, ...new TextEncoder().encode(tail)]);
    return POST(
      new Request("https://app.test/api/voice/transcribe", {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
          "user-agent": "DeepHaus/20 CFNetwork/3896.200.61 Darwin/27.2.0",
        },
        body,
      }),
    );
  }

  it("accepts the phone's recording, sent with no part Content-Type", async () => {
    const response = await phoneUpload("voice-prompt.m4a");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "Make ten cards on mitosis." });
    const [buffer, name] = transcribeDictation.mock.calls[0];
    expect(name).toBe("voice-prompt.m4a");
    expect(buffer.subarray(4, 12).toString("latin1")).toBe("ftypM4A ");
  });

  it("still rejects an untyped part whose name isn't audio", async () => {
    expect((await phoneUpload("notes.txt")).status).toBe(415);
    expect(transcribeDictation).not.toHaveBeenCalled();
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
