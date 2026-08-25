import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tryLocalApi, markPowerSyncServerWrite, getSession } = vi.hoisted(() => ({
  tryLocalApi: vi.fn(),
  markPowerSyncServerWrite: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/offline/local-api", () => ({ tryLocalApi }));
vi.mock("@/lib/offline/db", () => ({ markPowerSyncServerWrite }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession } }),
}));

import { apiFetch } from "@/lib/api/fetch";

const originalFetch = global.fetch;

describe("apiFetch offline routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: null } });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("falls back to local data for transient server failures on reads", async () => {
    const local = new Response(JSON.stringify({ source: "local" }), {
      status: 200,
    });
    tryLocalApi.mockResolvedValueOnce(null).mockResolvedValueOnce(local);
    global.fetch = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));

    const response = await apiFetch("/api/stats/dashboard");

    expect(response).toBe(local);
    expect(tryLocalApi).toHaveBeenLastCalledWith(
      "/api/stats/dashboard",
      undefined,
      true,
    );
  });

  it("marks successful server mutations until PowerSync catches up", async () => {
    tryLocalApi.mockResolvedValue(null);
    global.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await apiFetch("/api/cards/card-1", { method: "PUT" });

    expect(markPowerSyncServerWrite).toHaveBeenCalledOnce();
  });
});
