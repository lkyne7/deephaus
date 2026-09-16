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
  const upsert = vi.fn();
  const storageList = vi.fn();
  const storageRemove = vi.fn();
  const billingMaybeSingle = vi.fn();
  const deleteRequest = () =>
    new Request("http://localhost/api/account", { method: "DELETE" });

  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    deleteUser.mockResolvedValue({ error: null });
    upsert.mockResolvedValue({error:null});
    storageList.mockResolvedValue({ data: [], error: null });
    storageRemove.mockResolvedValue({ data: null, error: null });
    billingMaybeSingle.mockResolvedValue({ data: null, error: null });
    createServiceClient.mockReturnValue({
      auth: { admin: { deleteUser } },
      storage: { from: vi.fn(() => ({ list: storageList, remove: storageRemove })) },
      from: vi.fn(() => ({
        upsert,
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: billingMaybeSingle })),
        })),
      })),
    });
  });

  it("queues durable deletion without deleting auth or claiming completion", async () => {
    const response=await DELETE(deleteRequest());
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ok:true,status:"pending"});
    expect(upsert).toHaveBeenCalledWith({user_id:"user-1"},{onConflict:"user_id",ignoreDuplicates:true});
    expect(deleteUser).not.toHaveBeenCalled();
    expect(storageList).not.toHaveBeenCalled();
  });
  it("returns a retryable error when queue persistence fails",async()=>{
    upsert.mockResolvedValue({error:{message:"unavailable"}});
    expect((await DELETE(deleteRequest())).status).toBe(503);
    expect(deleteUser).not.toHaveBeenCalled();
  });
  it("does not guess subscription status on a failed billing lookup",async()=>{
    billingMaybeSingle.mockResolvedValue({data:null,error:{message:"unavailable"}});
    expect((await DELETE(deleteRequest())).status).toBe(503);
    expect(upsert).not.toHaveBeenCalled();
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
    expect(confirmed.status).toBe(202);
    expect(deleteUser).not.toHaveBeenCalled();
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
