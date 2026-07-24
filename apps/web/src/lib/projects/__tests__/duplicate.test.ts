import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { duplicateProject } from "@/lib/projects/duplicate";

type QueryResult = { data: unknown; error: { message: string } | null };

function makeChain(result: QueryResult) {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "in",
    "insert",
    "delete",
    "order",
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

describe("duplicateProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when the source deck is missing", async () => {
    const supabase = {
      from: vi.fn(() => makeChain({ data: null, error: null })),
    };

    await expect(
      duplicateProject(supabase as never, "missing", "user-1"),
    ).rejects.toMatchObject({
      name: "DuplicateProjectError",
      status: 404,
    });
  });

  it("copies cards and settings into a new deck named with copy", async () => {
    const inserts: Array<{ table: string; payload: unknown }> = [];

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "projects") {
          const chain = makeChain({
            data: {
              id: "proj-1",
              name: "Cardiology",
              deck_name: "Cardiology",
              settings: { cardMix: "basic", detailLevel: "high" },
            },
            error: null,
          });
          // First call loads source; insert creates the copy.
          let calls = 0;
          const wrapper = {
            select: vi.fn(() => wrapper),
            eq: vi.fn(() => wrapper),
            delete: vi.fn(() => wrapper),
            maybeSingle: vi.fn(async () => ({
              data: {
                id: "proj-1",
                name: "Cardiology",
                deck_name: "Cardiology",
                settings: { cardMix: "basic", detailLevel: "high" },
              },
              error: null,
            })),
            insert: vi.fn((payload: unknown) => {
              inserts.push({ table, payload });
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: {
                      id: "proj-2",
                      name: "Cardiology copy",
                      deck_name: "Cardiology copy",
                      settings: { cardMix: "basic", detailLevel: "high" },
                    },
                    error: null,
                  })),
                })),
              };
            }),
          };
          void calls;
          void chain;
          return wrapper;
        }

        if (table === "generation_jobs") {
          const jobsSelect = {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                then: (resolve: (value: QueryResult) => void) =>
                  resolve({ data: [{ id: "job-1" }], error: null }),
              })),
            })),
            insert: vi.fn((payload: unknown) => {
              inserts.push({ table, payload });
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: { id: "job-2" },
                    error: null,
                  })),
                })),
              };
            }),
          };
          return jobsSelect;
        }

        if (table === "cards") {
          return {
            select: vi.fn(() => ({
              in: vi.fn(() => ({
                order: vi.fn(() => ({
                  then: (resolve: (value: QueryResult) => void) =>
                    resolve({
                      data: [
                        {
                          type: "basic",
                          front: "Q",
                          back: "A",
                          cloze_text: null,
                          extra: null,
                          occlusion_data: null,
                          tags: ["heart"],
                          sort_order: 0,
                          source_ref: null,
                          source_quote: null,
                        },
                      ],
                      error: null,
                    }),
                })),
              })),
            })),
            insert: vi.fn(async (payload: unknown) => {
              inserts.push({ table, payload });
              return { data: null, error: null };
            }),
          };
        }

        if (table === "sources") {
          return {
            insert: vi.fn((payload: unknown) => {
              inserts.push({ table, payload });
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: { id: "src-2" },
                    error: null,
                  })),
                })),
              };
            }),
          };
        }

        return makeChain({ data: [], error: null });
      }),
    };

    const result = await duplicateProject(supabase as never, "proj-1", "user-1");
    expect(result).toMatchObject({
      id: "proj-2",
      name: "Cardiology copy",
      deck_name: "Cardiology copy",
      card_count: expect.any(Number),
    });
    expect(inserts.some((entry) => entry.table === "cards")).toBe(true);
    expect(inserts.some((entry) => entry.table === "projects")).toBe(true);
  });

});
