import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const {
  requireUser,
  createClient,
  googleDriveFetch,
  persistFileSource,
  persistFileSourceAndGenerate,
  enqueueSourcePreviewJob,
} = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  googleDriveFetch: vi.fn(),
  persistFileSource: vi.fn(),
  persistFileSourceAndGenerate: vi.fn(),
  enqueueSourcePreviewJob: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/google-drive/client", () => ({
  GoogleDriveAuthError: class GoogleDriveAuthError extends Error {},
  GoogleDriveNotConnectedError: class GoogleDriveNotConnectedError extends Error {},
  googleDriveFetch,
}));
vi.mock("@/lib/sources/persist-file-source", () => ({
  persistFileSource,
  persistFileSourceAndGenerate,
}));
vi.mock("@/lib/sources/preview", () => ({ enqueueSourcePreviewJob }));

import { POST } from "@/app/api/sources/google-drive/route";

function projectChain(found = true) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(async () => ({
      data: found ? { id: "project-1" } : null,
      error: found ? null : { message: "not found" },
    })),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

function request(fileId = "drive_file_1") {
  return new Request("https://app.test/api/sources/google-drive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project_id: "00000000-0000-4000-8000-000000000001",
      file_id: fileId,
    }),
  });
}

describe("POST /api/sources/google-drive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    createClient.mockResolvedValue({ from: vi.fn(() => projectChain()) });
    persistFileSource.mockResolvedValue({
      source: { id: "source-1", type: "docx", title: "Study notes.docx" },
      storageWarning: null,
    });
  });

  it("re-fetches metadata and exports Google Docs as DOCX", async () => {
    googleDriveFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "drive_file_1",
            name: "Study notes",
            mimeType: "application/vnd.google-apps.document",
            webViewLink: "https://docs.google.com/document/d/drive_file_1/edit",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([80, 75, 3, 4]), {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
      );

    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(googleDriveFetch.mock.calls[1]?.[1]).toContain("/export?mimeType=");
    expect(googleDriveFetch.mock.calls[1]?.[1]).toContain(
      encodeURIComponent(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    );
    expect(persistFileSource).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: "Study notes.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        externalUrl: "https://docs.google.com/document/d/drive_file_1/edit",
      }),
    );
  });

  it("rejects unsupported selected file types", async () => {
    googleDriveFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "drive_file_1",
          name: "Archive",
          mimeType: "application/zip",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(persistFileSource).not.toHaveBeenCalled();
  });

  it("does not call Drive when the project is not owned", async () => {
    createClient.mockResolvedValue({ from: vi.fn(() => projectChain(false)) });
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(googleDriveFetch).not.toHaveBeenCalled();
  });
});
