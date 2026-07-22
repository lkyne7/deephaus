import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import {
  currentCalendarMonth,
  normalizeBillingStatus,
} from "@/lib/billing/server";

const NOW = new Date("2026-07-21T12:00:00.000Z");

describe("billing status normalization", () => {
  it("defaults an absent account to Basic for the current UTC month", () => {
    const status = normalizeBillingStatus(null, null, NOW);

    expect(status).toMatchObject({
      plan: "basic",
      status: "inactive",
      isActive: false,
      priority: 0,
      credits: {
        periodStart: "2026-07-01",
        periodEnd: "2026-08-01",
        allowance: 250,
        used: 0,
        reserved: 0,
        remaining: 250,
      },
    });
  });

  it("returns paid access and current-period usage", () => {
    const status = normalizeBillingStatus(
      {
        plan: "plus",
        status: "active",
        source: "revenuecat",
        product_id: "plus_monthly",
        entitlement_ids: ["plus"],
        expires_at: "2026-08-01T00:00:00.000Z",
        will_renew: true,
        environment: "sandbox",
      },
      { allowance: 3000, used: 120, reserved: 30 },
      NOW,
    );

    expect(status).toMatchObject({
      plan: "plus",
      status: "active",
      isActive: true,
      willRenew: true,
      environment: "sandbox",
      credits: { allowance: 3000, used: 120, reserved: 30, remaining: 2850 },
    });
  });

  it("downgrades expired accounts without trusting their stored paid plan", () => {
    const status = normalizeBillingStatus(
      {
        plan: "pro",
        status: "active",
        expires_at: "2026-07-20T00:00:00.000Z",
        will_renew: true,
      },
      { allowance: 8000, used: 400, reserved: 25 },
      NOW,
    );

    expect(status.plan).toBe("basic");
    expect(status.status).toBe("expired");
    expect(status.isActive).toBe(false);
    expect(status.willRenew).toBe(false);
    expect(status.credits).toMatchObject({
      allowance: 250,
      used: 400,
      reserved: 25,
      remaining: 0,
    });
  });

  it("uses UTC calendar-month boundaries", () => {
    expect(currentCalendarMonth(new Date("2024-02-29T23:59:59Z"))).toEqual({
      periodStart: "2024-02-01",
      periodEnd: "2024-03-01",
    });
  });
});
