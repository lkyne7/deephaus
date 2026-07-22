import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const { requirePlan, requireUser } = vi.hoisted(() => ({
  requirePlan: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/billing/access", () => ({ requirePlan }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/occlusion/scan", () => ({
  scanForOcclusion: vi.fn(),
  supportsOcclusion: vi.fn(() => true),
}));
vi.mock("@/lib/notion/blocks-to-doc", () => ({
  importNotionPageDoc: vi.fn(),
}));

import { POST as scanOcclusion } from "@/app/api/sources/occlusion-scan/route";
import { POST as syncNotion } from "@/app/api/sources/[id]/notion-sync/route";

describe("paid source route gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({
      user: { id: "user-1" },
      response: null,
    });
    requirePlan.mockResolvedValue(
      Response.json(
        { code: "PLAN_UPGRADE_REQUIRED", currentPlan: "basic" },
        { status: 402 },
      ),
    );
  });

  it("blocks Basic users before scanning an upload for occlusion", async () => {
    const response = await scanOcclusion(
      new Request("https://app.test/api/sources/occlusion-scan", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(402);
    expect(requirePlan).toHaveBeenCalledWith(
      "user-1",
      "plus",
      "Automatic image occlusion",
    );
  });

  it("blocks Basic users before fetching a Notion source", async () => {
    const response = await syncNotion(
      new Request("https://app.test/api/sources/source-1/notion-sync", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "source-1" }) },
    );

    expect(response.status).toBe(402);
    expect(requirePlan).toHaveBeenCalledWith(
      "user-1",
      "plus",
      "Notion synchronization",
    );
  });
});
