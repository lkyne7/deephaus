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
