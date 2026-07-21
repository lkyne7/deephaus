import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const { requireUser, createClient, fetchAndExtractWebsite } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
  fetchAndExtractWebsite: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/websites/fetch-and-extract", () => ({
  WebsiteFetchError: class WebsiteFetchError extends Error {
    status = 422;
  },
  fetchAndExtractWebsite,
}));

import { POST } from "@/app/api/sources/website/route";

function chain(singleResult: unknown) {
  const value: Record<string, unknown> = {};
  for (const method of ["select", "eq", "insert"]) {
    value[method] = vi.fn(() => value);
  }
  value.single = vi.fn(async () => singleResult);
  return value;
}

function request(body: unknown) {
  return new Request("https://app.test/api/sources/website", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/sources/website", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    fetchAndExtractWebsite.mockResolvedValue({
      title: "Article title",
      canonicalUrl: "https://example.com/article",
      rawText: "Readable article text ".repeat(10),
      doc: { type: "doc", content: [{ type: "paragraph" }] },
    });
  });

  it("requires an owned project", async () => {
    createClient.mockResolvedValue({
      from: vi.fn(() => chain({ data: null, error: { message: "not found" } })),
    });
    const response = await POST(
      request({
        project_id: "00000000-0000-4000-8000-000000000001",
        url: "https://example.com/article",
      }),
    );
    expect(response.status).toBe(404);
    expect(fetchAndExtractWebsite).not.toHaveBeenCalled();
  });

  it("persists extracted content without generating by default", async () => {
    const project = chain({ data: { id: "project-1" }, error: null });
    const source = chain({
      data: {
        id: "source-1",
        type: "website",
        external_url: "https://example.com/article",
      },
      error: null,
    });
    createClient.mockResolvedValue({
      from: vi.fn((table: string) => (table === "projects" ? project : source)),
    });

    const response = await POST(
      request({
        project_id: "00000000-0000-4000-8000-000000000001",
        url: "https://example.com/article",
      }),
    );
    expect(response.status).toBe(201);
    expect(source.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "website",
        title: "Article title",
        external_url: "https://example.com/article",
      }),
    );
  });
});
