import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { requireUser, createServiceClient } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

import { DELETE } from "@/app/api/account/route";

describe("DELETE /api/account", () => {
  const deleteUser = vi.fn();
  const storageList = vi.fn();
  const storageRemove = vi.fn();
  const billingMaybeSingle = vi.fn();
  const deleteRequest = () =>
    new Request("http://localhost/api/account", { method: "DELETE" });

  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    deleteUser.mockResolvedValue({ error: null });
    storageList.mockResolvedValue({ data: [], error: null });
    storageRemove.mockResolvedValue({ data: null, error: null });
    billingMaybeSingle.mockResolvedValue({ data: null, error: null });
    createServiceClient.mockReturnValue({
      auth: { admin: { deleteUser } },
      storage: { from: vi.fn(() => ({ list: storageList, remove: storageRemove })) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: billingMaybeSingle })),
        })),
      })),
    });
  });

  it("deletes the signed-in user's auth account", async () => {
    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(deleteUser).toHaveBeenCalledWith("user-1");
  });

  it("removes the user's stored files before deleting", async () => {
    storageList
      .mockResolvedValueOnce({
        data: [{ id: "file-1", name: "avatar-1.png" }],
        error: null,
      })
      .mockResolvedValue({ data: [], error: null });

    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(200);
    expect(storageRemove).toHaveBeenCalledWith(["user-1/avatar-1.png"]);
    expect(deleteUser).toHaveBeenCalledWith("user-1");
  });

  it("still deletes the account when storage cleanup fails", async () => {
    storageList.mockRejectedValue(new Error("storage down"));
    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith("user-1");
  });

  it("surfaces auth deletion failures", async () => {
    deleteUser.mockResolvedValue({ error: { message: "boom" } });
    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(500);
  });

  it("requires explicit acknowledgement when a subscription may keep renewing", async () => {
    billingMaybeSingle.mockResolvedValue({
      data: {
        status: "active",
        will_renew: true,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
      error: null,
    });

    const blocked = await DELETE(deleteRequest());
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).code).toBe("ACTIVE_SUBSCRIPTION_RENEWS");
    expect(deleteUser).not.toHaveBeenCalled();

    const confirmed = await DELETE(
      new Request("http://localhost/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acknowledge_subscription_cancellation: true }),
      }),
    );
    expect(confirmed.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith("user-1");
  });

  it("requires an authenticated session", async () => {
    requireUser.mockResolvedValue({
      user: null,
      response: new Response(null, { status: 401 }),
    });
    const response = await DELETE(deleteRequest());
    expect(response.status).toBe(401);
    expect(deleteUser).not.toHaveBeenCalled();
  });
});
