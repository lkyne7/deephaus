import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  network: { isConnected: true, isInternetReachable: true },
  identity: {
    user: { id: "account-a" },
    access_token: "",
    expires_at: 0,
  } as any,
  token: null as any,
  callback: null as any,
  getSession: vi.fn(),
}));
vi.mock("@/lib/config", () => ({
  SUPABASE_URL: "https://fixture.supabase.co",
  authStorage: {
    getItem: async () => state.token && JSON.stringify(state.token),
  },
  loadOfflineIdentity: async () => state.identity,
  clearOfflineIdentity: async () => {
    state.identity = null;
  },
  supabase: {
    auth: {
      onAuthStateChange: (fn: any) => {
        state.callback = fn;
      },
      getSession: state.getSession,
    },
  },
}));
vi.mock("../lib/network-state", () => ({
  getCachedNetworkState: async () => state.network,
}));
beforeEach(() => {
  vi.resetModules();
  state.network = { isConnected: true, isInternetReachable: true };
  state.identity = {
    user: { id: "account-a" },
    access_token: "",
    expires_at: 0,
  };
  state.token = null;
  state.getSession.mockReset().mockResolvedValue({
    data: { session: null },
    error: new Error("Invalid Refresh Token"),
  });
});
it("keeps local ownership after refresh rejection without providing server credentials", async () => {
  const auth = await import("../lib/auth-session");
  const session = await auth.loadStoredSession();
  expect(session?.user.id).toBe("account-a");
  expect(session?.access_token).toBe("");
});
it("cold offline restart does not attempt a refresh and survives a null initial auth event", async () => {
  state.network.isConnected = false;
  const auth = await import("../lib/auth-session");
  state.callback("INITIAL_SESSION", null);
  expect((await auth.loadStoredSession())?.user.id).toBe("account-a");
  expect(state.getSession).not.toHaveBeenCalled();
});
it("explicit sign-out clears local identity and a new account replaces it", async () => {
  const auth = await import("../lib/auth-session");
  await auth.loadStoredSession();
  await auth.prepareExplicitSignOut();
  state.callback("SIGNED_OUT", null);
  await auth.completeExplicitSignOut();
  expect(state.identity).toBeNull();
  expect(await auth.loadStoredSession()).toBeNull();
  state.callback("SIGNED_IN", {
    user: { id: "account-b" },
    access_token: "b",
    expires_at: Date.now() / 1000 + 300,
  });
  expect((await auth.loadStoredSession())?.user.id).toBe("account-b");
});

it("retains offline ownership when a sign-out request fails", async () => {
  const auth = await import("../lib/auth-session");
  await auth.loadStoredSession();
  await auth.prepareExplicitSignOut();
  auth.cancelExplicitSignOut();
  state.network.isConnected = false;
  expect((await auth.loadStoredSession())?.user.id).toBe("account-a");
  expect(state.identity?.user.id).toBe("account-a");
});
