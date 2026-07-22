import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const { requireUser, createClient, detectOcclusionRectsByOcr, fetchMock } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  detectOcclusionRectsByOcr: vi.fn(),
  fetchMock: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/billing/access", () => ({
  requirePlan: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/occlusion/ocr", () => ({ detectOcclusionRectsByOcr }));
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, fetch: fetchMock };
});

import { POST } from "@/app/api/sources/[id]/occlusion/auto-detect/route";
import { sourceDocumentHasImageUrl } from "@/lib/sources/source-document-images";

const IMAGE_URL = "https://media.example/diagram.png";
const params = { params: Promise.resolve({ id: "source-1" }) };

function sourceQuery(data: unknown) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    query[method] = vi.fn(() => query);
  }
  query.single = vi.fn(async () => ({ data, error: data ? null : { message: "not found" } }));
  return query;
}

function request(imageUrl: unknown = IMAGE_URL) {
  return new Request("https://app.test/api/sources/source-1/occlusion/auto-detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
  });
}

function sourceWithImage(imageUrl = IMAGE_URL) {
  return {
    id: "source-1",
    edited_content: {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "image", attrs: { src: imageUrl, alt: "Diagram" } }],
            },
          ],
        },
      ],
    },
  };
}

describe("sourceDocumentHasImageUrl", () => {
  it("recursively matches only exact TipTap image src values", () => {
    const document = sourceWithImage().edited_content;
    expect(sourceDocumentHasImageUrl(document, IMAGE_URL)).toBe(true);
    expect(sourceDocumentHasImageUrl(document, `${IMAGE_URL}?other=1`)).toBe(false);
    expect(
      sourceDocumentHasImageUrl(
        { type: "paragraph", attrs: { src: IMAGE_URL } },
        IMAGE_URL,
      ),
    ).toBe(false);
  });
});

describe("POST /api/sources/[id]/occlusion/auto-detect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    detectOcclusionRectsByOcr.mockResolvedValue([
      {
        id: "region-1",
        x: -0.1,
        y: 0.25,
        width: 1.5,
        height: 0.2,
        label: "Cortex",
      },
    ]);
  });

  it("returns the auth response before loading a source", async () => {
    requireUser.mockResolvedValue({
      user: null,
      response: Response.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(request(), params);
    expect(response.status).toBe(401);
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an image URL that is not in the owned source document", async () => {
    const query = sourceQuery(sourceWithImage());
    createClient.mockResolvedValue({ from: vi.fn(() => query) });

    const response = await POST(request("https://internal.example/secret.png"), params);
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(detectOcclusionRectsByOcr).not.toHaveBeenCalled();
  });

  it("does not expose a source that the user does not own", async () => {
    const query = sourceQuery(null);
    createClient.mockResolvedValue({ from: vi.fn(() => query) });

    const response = await POST(request(), params);
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("detects and normalizes draft rects without writing cards", async () => {
    const query = sourceQuery(sourceWithImage());
    const from = vi.fn((table: string) => {
      expect(table).toBe("sources");
      return query;
    });
    createClient.mockResolvedValue({ from });
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      }),
    );

    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      IMAGE_URL,
      expect.objectContaining({ redirect: "error", dispatcher: expect.anything() }),
    );
    expect(detectOcclusionRectsByOcr).toHaveBeenCalledWith(
      expect.objectContaining({ length: 3 }),
    );
    expect(await response.json()).toEqual({
      occlusion_data: {
        imageUrl: IMAGE_URL,
        rects: [
          {
            id: "region-1",
            x: 0,
            y: 0.25,
            width: 1,
            height: 0.2,
            label: "Cortex",
            enabled: true,
            ord: 1,
          },
        ],
      },
      added: 1,
    });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized image responses before OCR", async () => {
    const query = sourceQuery(sourceWithImage());
    createClient.mockResolvedValue({ from: vi.fn(() => query) });
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(5 * 1024 * 1024 + 1),
        },
      }),
    );

    const response = await POST(request(), params);
    expect(response.status).toBe(413);
    expect(detectOcclusionRectsByOcr).not.toHaveBeenCalled();
  });

  it("rejects literal private network image addresses", async () => {
    const response = await POST(request("http://127.0.0.1/private.png"), params);
    expect(response.status).toBe(400);
    expect(createClient).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
