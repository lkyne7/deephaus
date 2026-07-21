import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sources/source-document-cache", () => ({
  invalidateCachedSourceDocument: vi.fn(),
}));

import { deleteSourcePreservingCards } from "@/lib/sources/delete-source";
import { invalidateCachedSourceDocument } from "@/lib/sources/source-document-cache";

type QueryResult = { data: unknown; error: { message: string } | null };

function makeChain(result: QueryResult, onUpdate?: (payload: unknown) => void) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  for (const method of [
    "select",
    "eq",
    "neq",
    "in",
    "order",
    "update",
    "delete",
    "insert",
  ]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      if (method === "update" && onUpdate) onUpdate(args[0]);
      return chain;
    });
  }
  chain.single = vi.fn(async () => result);
  // Thenable for awaited query builders without .single()
  chain.then = (resolve: (value: QueryResult) => void) => resolve(result);
  return chain;
}

describe("deleteSourcePreservingCards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears provenance, reassigns jobs, and deletes the source", async () => {
    const cardUpdates: unknown[] = [];
    const jobUpdates: unknown[] = [];
    let deletedSource = false;

    const tables: Record<string, ReturnType<typeof makeChain>> = {
      sources: makeChain({
        data: {
          id: "src-1",
          project_id: "proj-1",
          storage_path: "user/a.pdf",
          preview_storage_path: null,
        },
        error: null,
      }),
      source_chunks: makeChain({
        data: [{ id: "chunk-1" }],
        error: null,
      }),
      generation_jobs: makeChain(
        { data: [{ id: "job-1" }], error: null },
        (payload) => jobUpdates.push(payload),
      ),
      cards: makeChain(
        { data: [{ id: "card-1" }], error: null },
        (payload) => cardUpdates.push(payload),
      ),
    };

    // Second sources query (siblings) then delete
    let sourcesCall = 0;
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "sources") {
          sourcesCall += 1;
          if (sourcesCall === 1) {
            return makeChain({
              data: {
                id: "src-1",
                project_id: "proj-1",
                storage_path: "user/a.pdf",
                preview_storage_path: null,
              },
              error: null,
            });
          }
          if (sourcesCall === 2) {
            // siblings
            return makeChain({
              data: [{ id: "src-2", type: "pdf" }],
              error: null,
            });
          }
          // delete
          const chain = makeChain({ data: null, error: null });
          chain.delete = vi.fn(() => {
            deletedSource = true;
            return chain;
          });
          chain.eq = vi.fn(() => chain);
          chain.then = (resolve: (value: QueryResult) => void) =>
            resolve({ data: null, error: null });
          return chain;
        }
        if (table === "generation_jobs") {
          // First call: select job ids; later: update reassignment
          return tables.generation_jobs;
        }
        return tables[table] ?? makeChain({ data: [], error: null });
      }),
      storage: {
        from: vi.fn(() => ({
          remove: vi.fn(async () => ({ data: null, error: null })),
        })),
      },
    };

    const result = await deleteSourcePreservingCards(
      supabase as never,
      "src-1",
      "user-1",
    );

    expect(result).toEqual({
      sourceId: "src-1",
      projectId: "proj-1",
      unlinkedCards: 1,
    });
    expect(cardUpdates.some((u) => (u as { source_chunk_id: null }).source_chunk_id === null)).toBe(
      true,
    );
    expect(jobUpdates.some((u) => (u as { source_id: string }).source_id === "src-2")).toBe(true);
    expect(deletedSource).toBe(true);
    expect(invalidateCachedSourceDocument).toHaveBeenCalledWith("src-1");
  });

  it("returns 404 when the source is missing", async () => {
    const supabase = {
      from: vi.fn(() => makeChain({ data: null, error: null })),
      storage: { from: vi.fn() },
    };

    await expect(
      deleteSourcePreservingCards(supabase as never, "missing", "user-1"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
