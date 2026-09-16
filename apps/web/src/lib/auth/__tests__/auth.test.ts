import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getSession: vi.fn(),
  bearer: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getRequestBearerToken: mocks.bearer,
  createClient: async () => ({
    auth: { getUser: mocks.getUser, getSession: mocks.getSession },
  }),
  createServiceClient: vi.fn(() => {
    throw new Error("Must not use service access for invalid identity");
  }),
}));
vi.mock("@/lib/auth/api-token", () => ({ isApiToken: () => false }));
vi.mock("@/lib/perf/context", () => ({ setRequestUserId: vi.fn() }));
import { requireUser } from "../../auth";
describe("verified API identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bearer.mockResolvedValue(null);
  });
  it("does not trust a forged cookie user after verification fails", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 401 },
    });
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: "victim" } } },
    });
    expect((await requireUser()).response?.status).toBe(401);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
  it.each([null, "expired-token", "revoked-token"])(
    "rejects invalid credentials %s",
    async (token) => {
      mocks.bearer.mockResolvedValue(token);
      mocks.getUser.mockResolvedValue({
        data: { user: null },
        error: { status: 401 },
      });
      expect((await requireUser()).response?.status).toBe(401);
    },
  );
  it("distinguishes an auth outage without granting access", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { status: 503 },
    });
    const result = await requireUser();
    expect(result.user).toBeNull();
    expect(result.response?.status).toBe(503);
  });
  it("returns only the server-confirmed user", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "confirmed" } },
      error: null,
    });
    expect((await requireUser()).user?.id).toBe("confirmed");
  });
});
