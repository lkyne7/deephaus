import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { extractSourceFromFile } = vi.hoisted(() => ({
  extractSourceFromFile: vi.fn(),
}));

vi.mock("@/lib/sources/extract-source", () => ({
  extractSourceFromFile,
}));
vi.mock("@/lib/billing/access", () => ({
  getEffectivePlan: vi.fn().mockResolvedValue("basic"),
  getPlanUploadLimit: vi.fn().mockReturnValue(25 * 1024 * 1024),
}));

describe("file source persistence", () => {
  it("finishes the original-file upload before starting generation", async () => {
    extractSourceFromFile.mockResolvedValue({
      sourceType: "pdf",
      text: "--- Page 1 ---\n\nDiagram text",
      pageCount: 1,
    });
    let finishUpload!: (value: { error: null }) => void;
    const upload = new Promise<{ error: null }>((resolve) => {
      finishUpload = resolve;
    });
    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: "source-1" },
              error: null,
            }),
          })),
        })),
      })),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(() => upload),
        })),
      },
    };
    const runGeneration = vi.fn().mockResolvedValue({
      job: { id: "job-1" },
      cards: [],
    });

    const { persistFileSourceAndGenerate } = await import("../persist-file-source");
    const pending = persistFileSourceAndGenerate({
      supabase: supabase as never,
      userId: "user-1",
      projectId: "project-1",
      filename: "diagram.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("pdf"),
      creditIdempotencyKey: "video-transcription:user-1:request-1",
      runGeneration,
    });

    await vi.waitFor(() => expect(supabase.storage.from).toHaveBeenCalled());
    expect(runGeneration).not.toHaveBeenCalled();
    finishUpload({ error: null });
    await pending;
    expect(runGeneration).toHaveBeenCalledWith("source-1");
    expect(extractSourceFromFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      "diagram.pdf",
      "application/pdf",
      expect.objectContaining({
        creditContext: {
          userId: "user-1",
          idempotencyKey: "video-transcription:user-1:request-1",
        },
      }),
    );
  });
});
