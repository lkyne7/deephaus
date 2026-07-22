import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUser, loadBillingStatus } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  loadBillingStatus: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/billing/server", () => ({ loadBillingStatus }));

import { GET } from "@/app/api/billing/status/route";

describe("GET /api/billing/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({
      user: { id: "11111111-1111-4111-8111-111111111111" },
      response: null,
    });
    loadBillingStatus.mockResolvedValue({
      plan: "basic",
      status: "inactive",
      credits: { allowance: 250, used: 0, reserved: 0, remaining: 250 },
    });
  });

  it("returns normalized server billing status for the signed-in user", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      plan: "basic",
      credits: { remaining: 250 },
    });
    expect(loadBillingStatus).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("requires a signed-in user", async () => {
    requireUser.mockResolvedValue({
      user: null,
      response: new Response(null, { status: 401 }),
    });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(loadBillingStatus).not.toHaveBeenCalled();
  });
});
