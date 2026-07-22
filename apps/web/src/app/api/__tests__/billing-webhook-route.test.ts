import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createServiceClient } = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

import { POST } from "@/app/api/billing/revenuecat/webhook/route";
import {
  billingUpdateFromRevenueCatEvent,
  isRevenueCatWebhookAuthorized,
  planFromEntitlements,
} from "@/lib/billing/revenuecat-webhook";

const USER_ID = "11111111-1111-4111-8111-111111111111";

const baseEvent = {
  id: "evt-1",
  type: "RENEWAL",
  app_user_id: USER_ID,
  event_timestamp_ms: 200,
  environment: "production" as const,
  entitlement_ids: ["plus"],
  product_id: "plus_monthly",
  expiration_at_ms: Date.parse("2026-08-21T00:00:00.000Z"),
};

type FakeState = {
  events: Map<string, Record<string, unknown>>;
  account: Record<string, unknown> | null;
  rejectAccountInsert?: boolean;
};

function fakeService(state: FakeState) {
  const accountUpdate = vi.fn();

  return {
    accountUpdate,
    client: {
      from(table: string) {
        const filters: Record<string, unknown> = {};
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn((key: string, value: unknown) => {
            filters[key] = value;
            return query;
          }),
          maybeSingle: vi.fn(async () => {
            if (table === "billing_events") {
              return {
                data: state.events.get(String(filters.event_id)) ?? null,
                error: null,
              };
            }
            return { data: state.account, error: null };
          }),
          insert: vi.fn(async (value: Record<string, unknown>) => {
            if (table === "billing_events") {
              if (state.events.has(String(value.event_id))) {
                return { error: { code: "23505", message: "duplicate" } };
              }
              state.events.set(String(value.event_id), value);
              return { error: null };
            }
            if (state.rejectAccountInsert) {
              return { error: { code: "23503", message: "missing user" } };
            }
            if (state.account) {
              return { error: { code: "23505", message: "duplicate" } };
            }
            state.account = value;
            return { error: null };
          }),
          update: vi.fn((value: Record<string, unknown>) => {
            accountUpdate(value);
            return {
              eq: () => ({
                lt: async (_key: string, timestamp: number) => {
                  if (
                    state.account &&
                    Number(state.account.event_timestamp_ms) < timestamp
                  ) {
                    state.account = { ...state.account, ...value };
                  }
                  return { error: null };
                },
              }),
            };
          }),
        };
        return query;
      },
    },
  };
}

function webhookRequest(event: Record<string, unknown>, authorization = "Bearer test-secret") {
  return new Request("https://app.test/api/billing/revenuecat/webhook", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ event }),
  });
}

function subscriberFixture(
  entitlement = "plus",
  expiresDate = "2026-08-21T00:00:00.000Z",
) {
  const productId = `${entitlement}_monthly`;
  return {
    request_date_ms: Date.parse("2026-07-22T00:00:00.000Z"),
    subscriber: {
      entitlements: {
        [entitlement]: {
          expires_date: expiresDate,
          product_identifier: productId,
          purchase_date: "2026-07-21T00:00:00.000Z",
        },
      },
      subscriptions: {
        [productId]: {
          expires_date: expiresDate,
          period_type: "NORMAL",
          store: "stripe",
          unsubscribe_detected_at: null,
          billing_issues_detected_at: null,
        },
      },
    },
  };
}

describe("RevenueCat webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REVENUECAT_WEBHOOK_SECRET = "test-secret";
    process.env.REVENUECAT_SECRET_API_KEY = "sk_test_server_only";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(subscriberFixture())),
    );
  });

  it("authenticates exact or Bearer authorization values", () => {
    expect(isRevenueCatWebhookAuthorized("test-secret", "test-secret")).toBe(true);
    expect(isRevenueCatWebhookAuthorized("Bearer test-secret", "test-secret")).toBe(true);
    expect(isRevenueCatWebhookAuthorized("Bearer wrong", "test-secret")).toBe(false);
  });

  it("rejects unauthorized requests before touching the database", async () => {
    const response = await POST(webhookRequest(baseEvent, "Bearer wrong"));
    expect(response.status).toBe(401);
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("returns 200 without reprocessing duplicate event ids", async () => {
    const state: FakeState = {
      events: new Map([["evt-1", { event_id: "evt-1" }]]),
      account: null,
    };
    const service = fakeService(state);
    createServiceClient.mockReturnValue(service.client);

    const response = await POST(webhookRequest(baseEvent));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, duplicate: true });
    expect(state.account).toBeNull();
  });

  it("records stale events without overwriting newer account state", async () => {
    const state: FakeState = {
      events: new Map(),
      account: {
        user_id: USER_ID,
        plan: "pro",
        event_timestamp_ms: 300,
      },
    };
    const service = fakeService(state);
    createServiceClient.mockReturnValue(service.client);

    const response = await POST(webhookRequest({ ...baseEvent, event_timestamp_ms: 200 }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, stale: true });
    expect(state.events.has("evt-1")).toBe(true);
    expect(state.account?.plan).toBe("pro");
    expect(service.accountUpdate).not.toHaveBeenCalled();
  });

  it("reconciles current subscriber state instead of trusting a sparse expiration event", async () => {
    const state: FakeState = { events: new Map(), account: null };
    createServiceClient.mockReturnValue(fakeService(state).client);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(subscriberFixture("pro"))),
    );

    const response = await POST(
      webhookRequest({
        ...baseEvent,
        type: "EXPIRATION",
        entitlement_id: null,
        entitlement_ids: null,
      }),
    );

    expect(response.status).toBe(200);
    expect(state.account).toMatchObject({
      plan: "pro",
      status: "active",
      entitlement_ids: ["pro"],
    });
  });

  it("accepts transfer events without app_user_id and records them without a user FK", async () => {
    const state: FakeState = { events: new Map(), account: null };
    createServiceClient.mockReturnValue(fakeService(state).client);
    const from = "22222222-2222-4222-8222-222222222222";
    const to = "33333333-3333-4333-8333-333333333333";

    const response = await POST(
      webhookRequest({
        id: "evt-transfer",
        type: "TRANSFER",
        app_user_id: null,
        event_timestamp_ms: 400,
        entitlement_id: null,
        entitlement_ids: null,
        transferred_from: [from],
        transferred_to: [to],
      }),
    );

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.events.get("evt-transfer")?.user_id).toBeNull();
  });

  it("records deleted or unknown users as ignored events", async () => {
    const state: FakeState = {
      events: new Map(),
      account: null,
      rejectAccountInsert: true,
    };
    createServiceClient.mockReturnValue(fakeService(state).client);

    const response = await POST(webhookRequest(baseEvent));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, ignored: true });
    expect(state.events.get("evt-1")?.user_id).toBeNull();
  });

  it("keeps cancellation access until expiration and honors highest entitlement", () => {
    expect(planFromEntitlements(["plus", "pro"])).toBe("pro");
    const update = billingUpdateFromRevenueCatEvent(
      {
        ...baseEvent,
        type: "CANCELLATION",
        entitlement_ids: ["plus", "pro"],
      },
      USER_ID,
    );

    expect(update).toMatchObject({
      plan: "pro",
      status: "active",
      will_renew: false,
    });
  });

  it("downgrades expiration events to Basic", () => {
    const update = billingUpdateFromRevenueCatEvent(
      { ...baseEvent, type: "EXPIRATION", entitlement_ids: ["pro"] },
      USER_ID,
    );
    expect(update).toMatchObject({
      plan: "basic",
      status: "expired",
      will_renew: false,
      entitlement_ids: [],
    });
  });
});
