import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { detectByOcr, detectByVision } = vi.hoisted(() => ({
  detectByOcr: vi.fn(),
  detectByVision: vi.fn(),
}));

vi.mock("@/lib/occlusion/ocr", () => ({
  detectOcclusionRectsByOcr: detectByOcr,
}));
vi.mock("@deephaus/llm", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  detectOcclusionRects: detectByVision,
}));

describe("automatic image-occlusion cards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uploads a detected figure and creates an occlusion card row", async () => {
    detectByOcr.mockResolvedValue([
      {
        id: "region-1",
        x: 0.2,
        y: 0.3,
        width: 0.25,
        height: 0.08,
        label: "Mitochondrion",
        enabled: true,
      },
    ]);
    const upload = vi.fn().mockResolvedValue({ error: null });
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: "https://media.example/diagram.png" },
    });
    const supabase = {
      storage: {
        from: vi.fn(() => ({ upload, getPublicUrl })),
      },
    };

    const { buildOcclusionCardsFromImages } = await import("../occlusion-cards");
    const result = await buildOcclusionCardsFromImages(
      supabase as never,
      "user-1",
      "job-1",
      [
        {
          bytes: Buffer.from("image"),
          mime: "image/png",
          width: 640,
          height: 320,
          ref: "Page 1",
        },
      ],
      0,
    );

    expect(result.stats).toEqual({ scanned: 1, ocrCards: 1, visionCards: 0 });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      type: "image-occlusion",
      source_ref: "Page 1",
      occlusion_data: {
        imageUrl: "https://media.example/diagram.png",
        rects: [{ ord: 1, label: "Mitochondrion", enabled: true }],
      },
    });
    expect(upload).toHaveBeenCalledOnce();
    expect(detectByVision).not.toHaveBeenCalled();
  });

  it("uses vision when local OCR finds no labels", async () => {
    detectByOcr.mockResolvedValue([]);
    detectByVision.mockResolvedValue([
      {
        id: "region-vision",
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.1,
        label: "Axon",
        enabled: true,
      },
    ]);
    const supabase = {
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn().mockResolvedValue({ error: null }),
          getPublicUrl: vi.fn().mockReturnValue({
            data: { publicUrl: "https://media.example/axon.png" },
          }),
        })),
      },
    };

    const { buildOcclusionCardsFromImages } = await import("../occlusion-cards");
    const result = await buildOcclusionCardsFromImages(
      supabase as never,
      "user-1",
      "job-2",
      [
        {
          bytes: Buffer.from("image"),
          mime: "image/png",
          width: 640,
          height: 320,
          ref: "Page 2",
        },
      ],
      0,
      { vision: { apiKey: "test-key", model: "vision-test" } },
    );

    expect(result.stats.visionCards).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(detectByVision).toHaveBeenCalledOnce();
  });
});
