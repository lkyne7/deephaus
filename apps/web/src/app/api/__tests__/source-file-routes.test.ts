import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const { requireUser } = vi.hoisted(() => ({
  requireUser: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser }));

const { createClient } = vi.hoisted(() => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient }));

type TableResults = {
  single?: unknown;
  maybeSingle?: unknown;
  list?: unknown;
  insertSingle?: unknown;
};

/** Chainable Supabase query builder stub; terminal methods resolve results. */
function tableBuilder(results: TableResults) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  const inserted = vi.fn(self);
  for (const method of ["select", "eq", "not", "in", "is", "update"]) {
    chain[method] = vi.fn(self);
  }
  chain.insert = inserted;
  chain.order = vi.fn(() => {
    // `.order(...)` with no `.limit().maybeSingle()` resolves the list form.
    const ordered: Record<string, unknown> = {
      limit: vi.fn(() => ({
        maybeSingle: vi.fn(async () => results.maybeSingle ?? { data: null, error: null }),
      })),
      then: (resolve: (value: unknown) => void) =>
        resolve(results.list ?? { data: [], error: null }),
    };
    return ordered;
  });
  chain.limit = vi.fn(self);
  chain.single = vi.fn(async () => {
    if (inserted.mock.calls.length > 0 && results.insertSingle !== undefined) {
      return results.insertSingle;
    }
    return results.single ?? { data: null, error: null };
  });
  chain.maybeSingle = vi.fn(async () => results.maybeSingle ?? { data: null, error: null });
  return chain as Record<string, ReturnType<typeof vi.fn>> & { insert: typeof inserted };
}

function supabaseStub(tables: Record<string, ReturnType<typeof tableBuilder>>, signedUrl?: string | null) {
  return {
    from: vi.fn((table: string) => {
      const builder = tables[table];
      if (!builder) throw new Error(`Unexpected table: ${table}`);
      return builder;
    }),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () =>
          signedUrl
            ? { data: { signedUrl }, error: null }
            : { data: null, error: { message: "Object not found" } },
        ),
      })),
    },
  };
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
});

describe("GET /api/projects/[id]/sources", () => {
  it("maps rows into rail items with storage/preview/external flags", async () => {
    const supabase = supabaseStub({
      projects: tableBuilder({ single: { data: { id: "deck-1" }, error: null } }),
      sources: tableBuilder({
        list: {
          data: [
            {
              id: "s-pdf",
              type: "pdf",
              title: "Paper.pdf",
              page_count: 4,
              storage_path: "user-1/deck-1/paper.pdf",
              preview_storage_path: null,
              content_edited_at: null,
              created_at: "2026-07-20T00:00:00Z",
            },
            {
              id: "s-docx",
              type: "docx",
              title: "Notes.docx",
              page_count: null,
              storage_path: "user-1/deck-1/notes.docx",
              preview_storage_path: "user-1/deck-1/notes.docx.preview.pdf",
              content_edited_at: null,
              created_at: "2026-07-19T00:00:00Z",
            },
            {
              id: "s-yt",
              type: "youtube",
              title: null,
              page_count: null,
              storage_path: "https://www.youtube.com/watch?v=abc",
              preview_storage_path: null,
              content_edited_at: null,
              created_at: "2026-07-18T00:00:00Z",
            },
          ],
          error: null,
        },
      }),
    });
    createClient.mockResolvedValue(supabase);

    const { GET } = await import("../projects/[id]/sources/route");
    const res = await GET(new Request("http://test/api/projects/deck-1/sources"), params("deck-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sources: Array<Record<string, unknown>> };
    expect(body.sources).toHaveLength(3);
    expect(body.sources[0]).toMatchObject({
      id: "s-pdf",
      hasStorage: true,
      hasPreview: false,
      externalUrl: null,
    });
    expect(body.sources[1]).toMatchObject({ id: "s-docx", hasPreview: true });
    expect(body.sources[2]).toMatchObject({
      id: "s-yt",
      hasStorage: false,
      externalUrl: "https://www.youtube.com/watch?v=abc",
      title: "YouTube transcript",
    });
  });

  it("404s for decks the user does not own", async () => {
    const supabase = supabaseStub({
      projects: tableBuilder({ single: { data: null, error: null } }),
      sources: tableBuilder({}),
    });
    createClient.mockResolvedValue(supabase);

    const { GET } = await import("../projects/[id]/sources/route");
    const res = await GET(new Request("http://test/api/projects/deck-2/sources"), params("deck-2"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/sources/[id]/file", () => {
  it("returns a signed URL for a stored PDF original", async () => {
    const supabase = supabaseStub(
      {
        sources: tableBuilder({
          single: {
            data: {
              id: "s-1",
              type: "pdf",
              title: "Paper.pdf",
              storage_path: "user-1/deck-1/paper.pdf",
              preview_storage_path: null,
            },
            error: null,
          },
        }),
      },
      "https://signed.example/paper.pdf",
    );
    createClient.mockResolvedValue(supabase);

    const { GET } = await import("../sources/[id]/file/route");
    const res = await GET(new Request("http://test/api/sources/s-1/file"), params("s-1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; filename: string };
    expect(body.url).toBe("https://signed.example/paper.pdf");
    expect(body.filename).toBe("Paper.pdf");
  });

  it("404s when the source is not owned (RLS returns no row)", async () => {
    const supabase = supabaseStub({
      sources: tableBuilder({ single: { data: null, error: null } }),
    });
    createClient.mockResolvedValue(supabase);

    const { GET } = await import("../sources/[id]/file/route");
    const res = await GET(new Request("http://test/api/sources/s-x/file"), params("s-x"));
    expect(res.status).toBe(404);
  });

  it("404s for sources without a stored file (external / text)", async () => {
    const supabase = supabaseStub({
      sources: tableBuilder({
        single: {
          data: {
            id: "s-yt",
            type: "youtube",
            title: "Video",
            storage_path: "https://www.youtube.com/watch?v=abc",
            preview_storage_path: null,
          },
          error: null,
        },
      }),
    });
    createClient.mockResolvedValue(supabase);

    const { GET } = await import("../sources/[id]/file/route");
    const res = await GET(new Request("http://test/api/sources/s-yt/file"), params("s-yt"));
    expect(res.status).toBe(404);
  });

  it("404s the preview variant before the conversion has run", async () => {
    const supabase = supabaseStub(
      {
        sources: tableBuilder({
          single: {
            data: {
              id: "s-docx",
              type: "docx",
              title: "Notes.docx",
              storage_path: "user-1/deck-1/notes.docx",
              preview_storage_path: null,
            },
            error: null,
          },
        }),
      },
      "https://signed.example/should-not-be-used",
    );
    createClient.mockResolvedValue(supabase);

    const { GET } = await import("../sources/[id]/file/route");
    const res = await GET(
      new Request("http://test/api/sources/s-docx/file?variant=preview"),
      params("s-docx"),
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/sources/[id]/preview", () => {
  const docxSource = {
    id: "s-docx",
    type: "docx",
    title: "Notes.docx",
    storage_path: "user-1/deck-1/notes.docx",
    preview_storage_path: null,
  };

  it("returns ready without enqueueing when the preview already exists", async () => {
    const jobs = tableBuilder({});
    const supabase = supabaseStub({
      sources: tableBuilder({
        single: {
          data: { ...docxSource, preview_storage_path: "user-1/deck-1/notes.docx.preview.pdf" },
          error: null,
        },
      }),
      source_extraction_jobs: jobs,
    });
    createClient.mockResolvedValue(supabase);

    const { POST } = await import("../sources/[id]/preview/route");
    const res = await POST(new Request("http://test", { method: "POST" }), params("s-docx"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready" });
    expect(jobs.insert).not.toHaveBeenCalled();
  });

  it("reuses an in-flight conversion job instead of inserting a duplicate", async () => {
    const jobs = tableBuilder({
      maybeSingle: { data: { id: "job-1", status: "processing", error: null }, error: null },
    });
    const supabase = supabaseStub({
      sources: tableBuilder({ single: { data: docxSource, error: null } }),
      source_extraction_jobs: jobs,
    });
    createClient.mockResolvedValue(supabase);

    const { POST } = await import("../sources/[id]/preview/route");
    const res = await POST(new Request("http://test", { method: "POST" }), params("s-docx"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "processing", job_id: "job-1" });
    expect(jobs.insert).not.toHaveBeenCalled();
  });

  it("enqueues a preview job when none exists", async () => {
    const jobs = tableBuilder({
      maybeSingle: { data: null, error: null },
      insertSingle: { data: { id: "job-2", status: "pending" }, error: null },
    });
    const supabase = supabaseStub({
      sources: tableBuilder({ single: { data: docxSource, error: null } }),
      source_extraction_jobs: jobs,
    });
    createClient.mockResolvedValue(supabase);

    const { POST } = await import("../sources/[id]/preview/route");
    const res = await POST(new Request("http://test", { method: "POST" }), params("s-docx"));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "pending", job_id: "job-2" });
    expect(jobs.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        source_id: "s-docx",
        kind: "preview",
        storage_path: "user-1/deck-1/notes.docx",
      }),
    );
  });

  it("rejects sources that are not Office documents", async () => {
    const supabase = supabaseStub({
      sources: tableBuilder({
        single: {
          data: { ...docxSource, type: "pdf" },
          error: null,
        },
      }),
      source_extraction_jobs: tableBuilder({}),
    });
    createClient.mockResolvedValue(supabase);

    const { POST } = await import("../sources/[id]/preview/route");
    const res = await POST(new Request("http://test", { method: "POST" }), params("s-docx"));
    expect(res.status).toBe(400);
  });
});
