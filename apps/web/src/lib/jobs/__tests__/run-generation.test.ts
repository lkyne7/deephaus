import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseGenerationSettings } from "@deephaus/shared";

const {
  after,
  createServiceClient,
  processGenerationJob,
  releaseAiCredits,
  reserveAiCredits,
} = vi.hoisted(() => ({
  after: vi.fn(),
  createServiceClient: vi.fn(),
  processGenerationJob: vi.fn(),
  releaseAiCredits: vi.fn(),
  reserveAiCredits: vi.fn(),
}));

vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("@/lib/jobs/processor", () => ({ processGenerationJob }));
vi.mock("@/lib/credits/service", () => ({
  releaseAiCredits,
  reserveAiCredits,
}));

import {
  estimateGenerationCredits,
  runGenerationJob,
} from "@/lib/jobs/run-generation";

/** Minimal Supabase double covering the tables a generation run touches. */
function mockSupabase(source: Record<string, unknown>) {
  let insertedJob: Record<string, unknown> | null = null;

  const sourceQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(async () => ({ data: source, error: null })),
  };
  sourceQuery.select.mockReturnValue(sourceQuery);
  sourceQuery.eq.mockReturnValue(sourceQuery);

  const projectQuery = {
    update: vi.fn(),
    eq: vi.fn(async () => ({ error: null })),
  };
  projectQuery.update.mockReturnValue(projectQuery);

  const insertChain = {
    select: vi.fn(),
    single: vi.fn(async () => ({
      data: { ...insertedJob, created_at: "now", updated_at: "now" },
      error: null,
    })),
  };
  insertChain.select.mockReturnValue(insertChain);

  const updatedJobChain = {
    eq: vi.fn(),
    single: vi.fn(async () => ({ data: insertedJob, error: null })),
  };
  updatedJobChain.eq.mockReturnValue(updatedJobChain);

  const generationJobs = {
    insert: vi.fn((row: Record<string, unknown>) => {
      insertedJob = row;
      return insertChain;
    }),
    select: vi.fn(() => updatedJobChain),
  };

  const cardsChain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(async () => ({ data: [], error: null })),
  };
  cardsChain.select.mockReturnValue(cardsChain);
  cardsChain.eq.mockReturnValue(cardsChain);

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "sources") return sourceQuery;
      if (table === "projects") return projectQuery;
      if (table === "generation_jobs") return generationJobs;
      if (table === "cards") return cardsChain;
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { supabase, projectQuery, generationJobs };
}

describe("generation credit accounting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.DEEPHAUS_USE_MOCK_LLM;
    reserveAiCredits.mockResolvedValue({ id: "credit-1" });
    releaseAiCredits.mockResolvedValue({ id: "credit-1", status: "released" });
    processGenerationJob.mockResolvedValue(undefined);
  });

  it("estimates topic and source reservations from detail", () => {
    expect(
      estimateGenerationCredits({
        source: { type: "topic", raw_text: "Cell biology" },
        settings: parseGenerationSettings({ detailLevel: "high" }),
      }),
    ).toBe(25);

    expect(
      estimateGenerationCredits({
        source: { type: "text", raw_text: Array(1500).fill("word").join(" ") },
        settings: parseGenerationSettings({ detailLevel: "medium" }),
      }),
    ).toBe(8);
  });

  it("reserves before inserting a linked generation job", async () => {
    const source = {
      id: "source-1",
      project_id: "project-1",
      type: "text",
      raw_text: Array(1000).fill("word").join(" "),
      projects: {
        user_id: "user-1",
        settings: { detailLevel: "medium", cardMix: "basic" },
      },
    };
    const { supabase, generationJobs } = mockSupabase(source);

    await runGenerationJob(
      supabase as never,
      "source-1",
      { detailLevel: "medium" },
    );

    expect(reserveAiCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "generation",
        reservedCredits: 5,
        resourceType: "generation_job",
      }),
    );
    const reservation = reserveAiCredits.mock.calls[0][0];
    expect(reservation.idempotencyKey).toBe(
      `generation:${reservation.resourceId}`,
    );
    expect(generationJobs.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: reservation.resourceId,
      }),
    );
    expect(generationJobs.insert).toHaveBeenCalledWith(
      expect.not.objectContaining({
        credit_transaction_id: expect.anything(),
        plan_priority: expect.anything(),
      }),
    );
    expect(processGenerationJob).toHaveBeenCalledWith(
      reservation.resourceId,
      supabase,
      expect.any(Object),
    );
  });
});

describe("per-run generation instructions", () => {
  const source = (settings: Record<string, unknown>) => ({
    id: "source-1",
    project_id: "project-1",
    type: "text",
    raw_text: Array(1000).fill("word").join(" "),
    projects: { user_id: "user-1", settings },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-key";
    delete process.env.DEEPHAUS_USE_MOCK_LLM;
    reserveAiCredits.mockResolvedValue({ id: "credit-1" });
    processGenerationJob.mockResolvedValue(undefined);
  });

  it("stores this run's instructions on the project for the processor", async () => {
    const { supabase, projectQuery } = mockSupabase(source({ detailLevel: "medium" }));

    await runGenerationJob(supabase as never, "source-1", {
      detailLevel: "medium",
      customInstructions: "  Skip the history section.  ",
    });

    expect(projectQuery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ customInstructions: "Skip the history section." }),
      }),
    );
  });

  it("clears a previous run's instructions when this run has none", async () => {
    const { supabase, projectQuery } = mockSupabase(
      source({ detailLevel: "medium", customInstructions: "Skip the history section." }),
    );

    await runGenerationJob(supabase as never, "source-1");

    const stored = projectQuery.update.mock.calls[0][0].settings;
    expect(stored.customInstructions).toBeUndefined();
  });
});
