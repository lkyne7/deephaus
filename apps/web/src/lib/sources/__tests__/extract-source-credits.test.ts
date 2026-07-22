import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  parseBuffer,
  reserveAiCredits,
  settleAiCredits,
  releaseAiCredits,
  transcribeMedia,
} = vi.hoisted(() => ({
  parseBuffer: vi.fn(),
  reserveAiCredits: vi.fn(),
  settleAiCredits: vi.fn(),
  releaseAiCredits: vi.fn(),
  transcribeMedia: vi.fn(),
}));

vi.mock("music-metadata", () => ({ parseBuffer }));
vi.mock("@/lib/credits/service", () => ({
  reserveAiCredits,
  settleAiCredits,
  releaseAiCredits,
}));
vi.mock("@/lib/video/transcribe", () => ({
  transcriptionUsesPaidProvider: () => true,
  transcribeMedia,
}));

import { extractSourceFromFile } from "@/lib/sources/extract-source";

const creditContext = {
  userId: "00000000-0000-4000-8000-000000000001",
  idempotencyKey: "video-preview:test",
};

describe("video transcription credits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseBuffer.mockResolvedValue({ format: { duration: 61 } });
    reserveAiCredits.mockResolvedValue({ id: "credit-1" });
    settleAiCredits.mockResolvedValue({ id: "credit-1", status: "settled" });
    releaseAiCredits.mockResolvedValue({ id: "credit-1", status: "released" });
    transcribeMedia.mockResolvedValue({ text: "Transcript", segmentCount: 2 });
  });

  it("reserves by rounded-up duration and settles after Whisper succeeds", async () => {
    const result = await extractSourceFromFile(
      Buffer.from("video"),
      "lecture.mp4",
      "video/mp4",
      { creditContext },
    );

    expect(reserveAiCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        ...creditContext,
        action: "video_transcription",
        reservedCredits: 12,
      }),
    );
    expect(settleAiCredits).toHaveBeenCalledWith({
      ...creditContext,
      chargedCredits: 12,
    });
    expect(result.text).toBe("Transcript");
  });

  it("releases the reservation when Whisper fails", async () => {
    transcribeMedia.mockRejectedValue(new Error("vendor unavailable"));

    await expect(
      extractSourceFromFile(Buffer.from("video"), "lecture.mp4", "video/mp4", {
        creditContext,
      }),
    ).rejects.toThrow("vendor unavailable");

    expect(releaseAiCredits).toHaveBeenCalledWith(creditContext);
    expect(settleAiCredits).not.toHaveBeenCalled();
  });

  it("does not call the vendor when duration cannot be determined", async () => {
    parseBuffer.mockResolvedValue({ format: {} });

    await expect(
      extractSourceFromFile(Buffer.from("video"), "lecture.mp4", "video/mp4", {
        creditContext,
      }),
    ).rejects.toThrow("Could not determine the media duration");

    expect(reserveAiCredits).not.toHaveBeenCalled();
    expect(transcribeMedia).not.toHaveBeenCalled();
  });
});
