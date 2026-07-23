import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createServiceClient } = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

import {
  AiCreditsExhaustedError,
  creditIdempotencyKey,
  parseAiCreditError,
  releaseAiCredits,
  reserveAiCredits,
  settleAiCredits,
  type AiCreditTransaction,
} from "@/lib/credits/service";

function transaction(
  status: AiCreditTransaction["status"] = "reserved",
): AiCreditTransaction {
  return {
    id: "transaction-1",
    user_id: "user-1",
    period_id: "period-1",
    idempotency_key: "test:key",
    action: "test",
    status,
    reserved_credits: 2,
    charged_credits: status === "settled" ? 2 : 0,
    resource_type: null,
    resource_id: null,
    metadata: {},
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  };
}

function clientWithResults(results: Array<{ data: unknown; error: unknown }>) {
  const update = vi.fn();
  const insert = vi.fn();
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.insert = insert.mockImplementation(() => chain);
  chain.update = update.mockImplementation(() => chain);
  chain.maybeSingle = vi.fn(async () => results.shift());
  chain.single = vi.fn(async () => results.shift());
  return {
    client: { from: vi.fn(() => chain) },
    insert,
    update,
  };
}

describe("AI credit service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes request idempotency keys by operation and user", () => {
    const first = creditIdempotencyKey("user-1", "assistant:hint", "retry-1");
    expect(creditIdempotencyKey("user-1", "assistant:hint", "retry-1")).toBe(
      first,
    );
    expect(creditIdempotencyKey("user-2", "assistant:hint", "retry-1")).not.toBe(
      first,
    );
    expect(creditIdempotencyKey("user-1", "source-search", "retry-1")).not.toBe(
      first,
    );
  });

  it("maps exhausted database messages to a typed error", () => {
    const error = parseAiCreditError({
      message: "AI_CREDITS_EXHAUSTED:250:241:12",
    });

    expect(error).toBeInstanceOf(AiCreditsExhaustedError);
    expect(error).toMatchObject({
      allowance: 250,
      consumed: 241,
      required: 12,
    });
  });

  it("returns an existing matching reservation without inserting", async () => {
    const existing = transaction();
    const { client, insert } = clientWithResults([{ data: existing, error: null }]);
    createServiceClient.mockReturnValue(client);

    await expect(
      reserveAiCredits({
        userId: "user-1",
        idempotencyKey: "test:key",
        action: "test",
        reservedCredits: 2,
      }),
    ).resolves.toEqual(existing);
    expect(insert).not.toHaveBeenCalled();
  });

  it("surfaces an exhausted reservation as the typed error", async () => {
    const { client } = clientWithResults([
      { data: null, error: null },
      {
        data: null,
        error: { message: "AI_CREDITS_EXHAUSTED:250:249:2" },
      },
    ]);
    createServiceClient.mockReturnValue(client);

    await expect(
      reserveAiCredits({
        userId: "user-1",
        idempotencyKey: "test:key",
        action: "test",
        reservedCredits: 2,
      }),
    ).rejects.toMatchObject({
      allowance: 250,
      consumed: 249,
      required: 2,
    });
  });

  it("settles a reserved transaction with the actual charge", async () => {
    const reserved = transaction();
    const settled = transaction("settled");
    const { client, update } = clientWithResults([
      { data: reserved, error: null },
      { data: settled, error: null },
    ]);
    createServiceClient.mockReturnValue(client);

    await expect(
      settleAiCredits({
        userId: "user-1",
        idempotencyKey: "test:key",
        chargedCredits: 2,
      }),
    ).resolves.toEqual(settled);
    expect(update).toHaveBeenCalledWith({
      status: "settled",
      charged_credits: 2,
    });
  });

  it("caps the settled charge at the reserved hold", async () => {
    const reserved = transaction();
    const settled = transaction("settled");
    const { client, update } = clientWithResults([
      { data: reserved, error: null },
      { data: settled, error: null },
    ]);
    createServiceClient.mockReturnValue(client);

    await expect(
      settleAiCredits({
        userId: "user-1",
        idempotencyKey: "test:key",
        chargedCredits: 16,
      }),
    ).resolves.toEqual(settled);
    expect(update).toHaveBeenCalledWith({
      status: "settled",
      charged_credits: reserved.reserved_credits,
    });
  });

  it("does not reverse a terminal transaction during release cleanup", async () => {
    const settled = transaction("settled");
    const { client, update } = clientWithResults([{ data: settled, error: null }]);
    createServiceClient.mockReturnValue(client);

    await expect(
      releaseAiCredits({
        userId: "user-1",
        idempotencyKey: "test:key",
      }),
    ).resolves.toEqual(settled);
    expect(update).not.toHaveBeenCalled();
  });

  it("does not report a released reservation as settled", async () => {
    const released = transaction("released");
    const { client, update } = clientWithResults([{ data: released, error: null }]);
    createServiceClient.mockReturnValue(client);

    await expect(
      settleAiCredits({
        userId: "user-1",
        idempotencyKey: "test:key",
        chargedCredits: 2,
      }),
    ).rejects.toThrow("already released");
    expect(update).not.toHaveBeenCalled();
  });
});
