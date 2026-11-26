import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { revenueCatAnalyticsEvent } from "@/lib/billing/revenuecat-analytics";
import { parseRevenueCatWebhookBody } from "@/lib/billing/revenuecat-webhook";

const USER = "8f14e45f-ceea-467f-a0e6-0b5b3f0a0c11";

function parse(event: Record<string, unknown>) {
  const parsed = parseRevenueCatWebhookBody({
    event: { id: "evt", event_timestamp_ms: 1, app_user_id: USER, ...event },
  });
  if (!parsed.success) throw new Error("fixture did not parse");
  return parsed.data.event;
}

describe("revenueCatAnalyticsEvent", () => {
  it("records a paid first purchase with revenue and plan", () => {
    const out = revenueCatAnalyticsEvent(
      parse({ type: "INITIAL_PURCHASE", period_type: "NORMAL", price: 14.99, store: "STRIPE" }),
      "pro",
    );
    expect(out).toMatchObject({
      distinctId: USER,
      event: "subscription_started",
      properties: { $revenue: 14.99, store: "stripe", $set: { plan: "pro", is_paid: true } },
    });
  });

  it("records a trial start without revenue", () => {
    const out = revenueCatAnalyticsEvent(
      parse({ type: "INITIAL_PURCHASE", period_type: "TRIAL", price: 0 }),
      "pro",
    );
    expect(out?.event).toBe("trial_started");
    expect(out?.properties).not.toHaveProperty("$revenue");
  });

  it("keeps the reconciled plan when one of two subscriptions expires", () => {
    const out = revenueCatAnalyticsEvent(parse({ type: "EXPIRATION", entitlement_ids: ["plus"] }), "pro");
    expect(out).toMatchObject({ event: "subscription_expired", properties: { $set: { plan: "pro" } } });
  });

  it("leaves the person's plan alone when it is unknown", () => {
    const out = revenueCatAnalyticsEvent(parse({ type: "TRANSFER" }), null);
    expect(out?.event).toBe("subscription_updated");
    expect(out?.properties).not.toHaveProperty("$set");
  });

  it("counts refunds but not prices on events without a charge", () => {
    const revenue = (type: string, price: number) =>
      revenueCatAnalyticsEvent(parse({ type, price }), "pro")?.properties.$revenue;
    expect(revenue("CANCELLATION", -9.99)).toBe(-9.99);
    expect(revenue("CANCELLATION", 9.99)).toBeUndefined();
    expect(revenue("PRODUCT_CHANGE", 9.99)).toBeUndefined();
  });

  it("skips events without a user", () => {
    expect(revenueCatAnalyticsEvent(parse({ type: "RENEWAL", app_user_id: null }), "pro")).toBeNull();
  });
});
