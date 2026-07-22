import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { createServiceClient } = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

import { rollbackPersistedCards } from "@/lib/jobs/processor";

describe("generation credit settlement compensation", () => {
  it("removes all cards from the job when settlement fails", async () => {
    const eq = vi.fn(async () => ({ error: null }));
    const deleteRows = vi.fn(() => ({ eq }));
    const supabase = {
      from: vi.fn((table: string) => {
        expect(table).toBe("cards");
        return { delete: deleteRows };
      }),
    };

    await expect(
      rollbackPersistedCards(
        supabase as never,
        "job-1",
        new Error("settlement unavailable"),
      ),
    ).rejects.toThrow("inserted cards were rolled back");
    expect(deleteRows).toHaveBeenCalledOnce();
    expect(eq).toHaveBeenCalledWith("job_id", "job-1");
  });

  it("surfaces a rollback failure instead of leaving it silent", async () => {
    const supabase = {
      from: vi.fn(() => ({
        delete: () => ({
          eq: async () => ({ error: { message: "delete denied" } }),
        }),
      })),
    };
    createServiceClient.mockReturnValue({
      from: vi.fn(() => ({
        delete: () => ({
          eq: async () => ({ error: { message: "service delete denied" } }),
        }),
      })),
    });

    await expect(
      rollbackPersistedCards(
        supabase as never,
        "job-1",
        new Error("settlement unavailable"),
      ),
    ).rejects.toThrow(
      "persisted cards could not be rolled back: service delete denied",
    );
  });
});
