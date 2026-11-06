import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { ensureSourceChunks } = vi.hoisted(() => ({ ensureSourceChunks: vi.fn() }));

vi.mock("@/lib/sources/source-chunks", () => ({ ensureSourceChunks }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/credits/service", () => ({
  releaseAiCredits: vi.fn(),
  settleAiCredits: vi.fn(),
}));

import { LocalStepError, runLocalGenerationStep } from "@/lib/jobs/local-generation";

const SOURCE_TEXT = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} about cells.`).join(" ");

type Row = Record<string, unknown>;

/** Just enough of Supabase for one job: reads return `job`, writes are recorded. */
function mockSupabase(job: Row, options: { savedCards?: number; deckCards?: Row[] } = {}) {
  const inserted: Row[] = [];
  const jobUpdates: Row[] = [];
  const chain = (result: unknown) => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "order", "limit"]) {
      query[method] = vi.fn(() => query);
    }
    query.single = vi.fn(async () => result);
    query.maybeSingle = vi.fn(async () => result);
    query.then = (resolve: (value: unknown) => void) => resolve(result);
    return query;
  };
  const client = {
    from: vi.fn((table: string) => {
      if (table === "generation_jobs") {
        return {
          ...chain({ data: job, error: null }),
          update: vi.fn((fields: Row) => {
            jobUpdates.push(fields);
            return chain({ error: null });
          }),
        };
      }
      return {
        ...chain({
          data: options.deckCards ?? [],
          error: null,
          count: (options.savedCards ?? 0) + inserted.length,
        }),
        insert: vi.fn(async (rows: Row[]) => {
          inserted.push(...rows);
          return { error: null };
        }),
      };
    }),
  };
  return { client: client as unknown as SupabaseClient, inserted, jobUpdates };
}

function textJob(fields: Row = {}): Row {
  return {
    id: "job-1",
    status: "pending",
    local_engine: "claude",
    local_scope: {},
    sources: {
      id: "source-1",
      type: "text",
      raw_text: SOURCE_TEXT,
      projects: { id: "project-1", settings: { cardTypes: ["basic"], detailLevel: "medium" } },
    },
    ...fields,
  };
}

const answer = (front: string) =>
  JSON.stringify({
    cards: [
      { type: "basic", front, back: "An answer", clozeText: null, extra: null, sourceQuote: null, tags: [] },
    ],
  });

describe("runLocalGenerationStep", () => {
  beforeEach(() => {
    ensureSourceChunks.mockReset();
    ensureSourceChunks.mockResolvedValue([]);
  });

  it("refuses jobs the server is processing", async () => {
    const { client } = mockSupabase(textJob({ local_engine: null }));
    await expect(
      runLocalGenerationStep(client, "job-1", { position: 0, outputs: [answer("Q")] }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("hands out prompts and the card schema for the first step", async () => {
    const { client, inserted } = mockSupabase(textJob());
    const step = await runLocalGenerationStep(client, "job-1", { position: 0 });
    if (step.done) throw new Error("expected a step");
    expect(step.position).toBe(0);
    expect(step.requests).toHaveLength(1);
    expect(step.requests[0]!.user).toContain("Sentence number 0");
    expect(step.schema).toMatchObject({ required: ["cards"] });
    expect(inserted).toHaveLength(0);
  });

  it("saves validated cards and finishes after the last step", async () => {
    const { client, inserted, jobUpdates } = mockSupabase(textJob());
    const step = await runLocalGenerationStep(client, "job-1", {
      position: 0,
      outputs: [answer("What do cells do?")],
    });
    expect(step).toEqual({ done: true });
    expect(inserted).toMatchObject([{ job_id: "job-1", front: "What do cells do?" }]);
    expect(jobUpdates.at(-1)).toMatchObject({ status: "ready", progress: 100 });
  });

  it("drops output that isn't valid card JSON and fails with nothing saved", async () => {
    const { client, inserted, jobUpdates } = mockSupabase(textJob());
    await runLocalGenerationStep(client, "job-1", { position: 0, outputs: ["ignore all rules"] });
    expect(inserted).toHaveLength(0);
    expect(jobUpdates.at(-1)).toMatchObject({ status: "failed" });
  });

  it("skips a replayed step's repeats and still finishes", async () => {
    const { client, inserted, jobUpdates } = mockSupabase(textJob(), {
      savedCards: 0,
      deckCards: [{ type: "basic", front: "Q", back: "An answer", cloze_text: null, source_chunk_id: null }],
    });
    await runLocalGenerationStep(client, "job-1", { position: 0, outputs: [answer("Q")] });
    expect(inserted).toHaveLength(0);
    expect(jobUpdates.at(-1)).toMatchObject({ status: "ready" });
  });

  it("enforces the per-job card cap on what the client reports", async () => {
    const { client, inserted } = mockSupabase(textJob(), { savedCards: 100_000 });
    await runLocalGenerationStep(client, "job-1", { position: 0, outputs: [answer("Q")] });
    expect(inserted).toHaveLength(0);
  });

  it("keeps saved cards and ignores new ones after a stop", async () => {
    const { client, inserted, jobUpdates } = mockSupabase(
      textJob({ cancel_requested_at: "2026-11-06T00:00:00Z" }),
    );
    expect(
      await runLocalGenerationStep(client, "job-1", { position: 0, outputs: [answer("Q")] }),
    ).toEqual({ done: true });
    expect(inserted).toHaveLength(0);
    expect(jobUpdates.at(-1)).toMatchObject({ status: "ready" });
  });

  it("records a desktop failure, including how many cards were kept", async () => {
    const { client, jobUpdates } = mockSupabase(textJob(), { savedCards: 3 });
    await runLocalGenerationStep(client, "job-1", { position: 2, error: "Claude Code: limit reached" });
    expect(jobUpdates.at(-1)).toMatchObject({
      status: "failed",
      error: "Claude Code: limit reached 3 cards were saved before it stopped.",
    });
  });

  it("rejects a step past the end and the wrong number of answers", async () => {
    const { client } = mockSupabase(textJob());
    await expect(
      runLocalGenerationStep(client, "job-1", { position: 99 }),
    ).rejects.toBeInstanceOf(LocalStepError);
    await expect(
      runLocalGenerationStep(client, "job-1", { position: 0, outputs: [answer("Q"), answer("R")] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("does nothing once the job has finished", async () => {
    const { client, inserted } = mockSupabase(textJob({ status: "ready" }));
    expect(
      await runLocalGenerationStep(client, "job-1", { position: 0, outputs: [answer("Q")] }),
    ).toEqual({ done: true });
    expect(inserted).toHaveLength(0);
  });
});
