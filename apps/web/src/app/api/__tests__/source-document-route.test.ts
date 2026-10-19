import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const { requireUser, createClient } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/sources/source-document", () => ({ buildSourceDocument: vi.fn() }));

import { PUT } from "@/app/api/sources/[id]/document/route";

type Row = Record<string, unknown>;

/** Minimal PostgREST-style table: eq/is filters, update, delete, select. */
function fakeSupabase(tables: Record<string, Row[]>) {
  function builder(table: string) {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | null = null;
    let remove = false;
    const matching = () => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
    const run = () => {
      const rows = matching();
      if (patch) for (const row of rows) Object.assign(row, patch);
      if (remove) tables[table] = (tables[table] ?? []).filter((row) => !rows.includes(row));
      return rows.map((row) => ({ ...row }));
    };
    const query: Record<string, unknown> = {
      select: () => query,
      update: (values: Row) => {
        patch = values;
        return query;
      },
      delete: () => {
        remove = true;
        return query;
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) =>
          column === "content_edited_at"
            ? row[column] != null && Date.parse(String(row[column])) === Date.parse(String(value))
            : row[column] === value,
        );
        return query;
      },
      is: (column: string, value: null) => {
        filters.push((row) => row[column] === value);
        return query;
      },
      single: async () => {
        const rows = run();
        return rows.length === 1
          ? { data: rows[0], error: null }
          : { data: null, error: { message: "not found" } };
      },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: run(), error: null }),
    };
    return query;
  }
  return { from: vi.fn((table: string) => builder(table)) };
}

const params = { params: Promise.resolve({ id: "source-1" }) };
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

function put(body: unknown) {
  return new Request("https://app.test/api/sources/source-1/document", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /api/sources/[id]/document", () => {
  let tables: Record<string, Row[]>;

  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    tables = {
      sources: [
        {
          id: "source-1",
          user_id: "user-1",
          type: "text",
          edited_content: doc("Newer edit from another tab"),
          raw_text: "Newer edit from another tab",
          content_edited_at: "2026-10-19T12:00:05.000+00:00",
        },
      ],
      source_chunks: [{ source_id: "source-1" }],
    };
    createClient.mockResolvedValue(fakeSupabase(tables));
  });

  it("rejects a save based on a stale version without overwriting newer edits", async () => {
    const response = await PUT(
      put({ content: doc("Stale tab"), contentEditedAt: "2026-10-19T12:00:00.000Z" }),
      params,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      contentEditedAt: "2026-10-19T12:00:05.000+00:00",
    });
    expect(tables.sources[0].raw_text).toBe("Newer edit from another tab");
    expect(tables.source_chunks).toHaveLength(1);
  });

  it("requires the version the editor loaded", async () => {
    const response = await PUT(put({ content: doc("No version") }), params);
    expect(response.status).toBe(428);
    expect(tables.sources[0].raw_text).toBe("Newer edit from another tab");
  });

  it("saves the current version and returns the next one", async () => {
    const response = await PUT(
      put({ content: doc("Fresh edit"), contentEditedAt: "2026-10-19T12:00:05.000Z" }),
      params,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.contentEditedAt).toBe(tables.sources[0].content_edited_at);
    expect(body.contentEditedAt).not.toBe("2026-10-19T12:00:05.000+00:00");
    expect(tables.sources[0].raw_text).toBe("Fresh edit");
    expect(tables.source_chunks).toHaveLength(0);
  });

  it("accepts a null version for a document that was never edited", async () => {
    tables.sources[0].content_edited_at = null;
    const response = await PUT(put({ content: doc("First edit"), contentEditedAt: null }), params);
    expect(response.status).toBe(200);
    expect(tables.sources[0].raw_text).toBe("First edit");
  });

  it("rejects a null version once the document has been edited", async () => {
    const response = await PUT(put({ content: doc("Stale"), contentEditedAt: null }), params);
    expect(response.status).toBe(409);
    expect(tables.sources[0].raw_text).toBe("Newer edit from another tab");
  });
});
