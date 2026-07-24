import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { releaseAiCredits, createServiceClient } = vi.hoisted(() => ({
  releaseAiCredits: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/credits/service", () => ({ releaseAiCredits }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

import { DeleteProjectError, deleteProject } from "@/lib/projects/delete";

type QueryResult = { data: unknown; error: { message: string } | null };

function makeChain(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "in",
    "delete",
    "maybeSingle",
    "single",
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle = vi.fn(async () => result);
  chain.single = vi.fn(async () => result);
  chain.then = (resolve: (value: QueryResult) => void) => resolve(result);
  return chain;
}

describe("deleteProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    releaseAiCredits.mockResolvedValue({ id: "tx-1", status: "released" });
    createServiceClient.mockReturnValue({
      from: vi.fn(() =>
        makeChain({
          data: [{ idempotency_key: "generation:job-1", status: "reserved" }],
          error: null,
        }),
      ),
      storage: {
        from: vi.fn(() => ({
          list: vi.fn(async () => ({ data: [], error: null })),
          remove: vi.fn(async () => ({ data: null, error: null })),
        })),
      },
    });
  });

  it("returns 404 when the deck is missing", async () => {
    const supabase = {
      from: vi.fn(() => makeChain({ data: null, error: null })),
    };

    await expect(
      deleteProject(supabase as never, "missing", "user-1"),
    ).rejects.toMatchObject({
      name: "DeleteProjectError",
      status: 404,
    });
  });

  it("releases reserved credits and deletes the project", async () => {
    let deleted = false;
    const tables: Record<string, ReturnType<typeof makeChain>> = {
      projects: makeChain({
        data: { id: "proj-1", user_id: "user-1" },
        error: null,
      }),
      sources: makeChain({
        data: [
          {
            id: "src-1",
            storage_path: "user-1/proj-1/a.pdf",
            preview_storage_path: null,
          },
        ],
        error: null,
      }),
      generation_jobs: makeChain({
        data: [
          {
            id: "job-1",
            status: "generating",
            credit_transaction_id: "tx-1",
          },
        ],
        error: null,
      }),
      source_extraction_jobs: makeChain({ data: [], error: null }),
      cards: makeChain({ data: [{ id: "card-1" }], error: null }),
    };

    const projectsDelete = makeChain({ data: null, error: null });
    projectsDelete.delete = vi.fn(() => {
      deleted = true;
      return projectsDelete;
    });
    projectsDelete.eq = vi.fn(() => projectsDelete);
    projectsDelete.then = (resolve: (value: QueryResult) => void) =>
      resolve({ data: null, error: null });

    let projectCalls = 0;
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "projects") {
          projectCalls += 1;
          if (projectCalls === 1) return tables.projects;
          return projectsDelete;
        }
        return tables[table] ?? makeChain({ data: [], error: null });
      }),
    };

    await expect(
      deleteProject(supabase as never, "proj-1", "user-1"),
    ).resolves.toEqual({ projectId: "proj-1" });

    expect(releaseAiCredits).toHaveBeenCalledWith({
      userId: "user-1",
      idempotencyKey: "generation:job-1",
    });
    expect(deleted).toBe(true);
  });

  it("surfaces database delete failures", async () => {
    const tables: Record<string, ReturnType<typeof makeChain>> = {
      projects: makeChain({
        data: { id: "proj-1", user_id: "user-1" },
        error: null,
      }),
      sources: makeChain({ data: [], error: null }),
      generation_jobs: makeChain({ data: [], error: null }),
      source_extraction_jobs: makeChain({ data: [], error: null }),
      cards: makeChain({ data: [], error: null }),
    };

    const failingDelete = makeChain({
      data: null,
      error: { message: "boom" },
    });
    failingDelete.delete = vi.fn(() => failingDelete);
    failingDelete.eq = vi.fn(() => failingDelete);

    let projectCalls = 0;
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "projects") {
          projectCalls += 1;
          if (projectCalls === 1) return tables.projects;
          return failingDelete;
        }
        return tables[table] ?? makeChain({ data: [], error: null });
      }),
    };

    await expect(
      deleteProject(supabase as never, "proj-1", "user-1"),
    ).rejects.toBeInstanceOf(DeleteProjectError);
  });
});
