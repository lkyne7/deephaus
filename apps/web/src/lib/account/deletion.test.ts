import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  deleteUser: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    rpc: mocks.rpc,
    storage: { from: () => ({ list: mocks.list, remove: mocks.remove }) },
    auth: { admin: { deleteUser: mocks.deleteUser } },
    from: () => ({ update: mocks.update }),
  }),
}));
import { processAccountDeletions } from "./deletion";
describe("durable deletion worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: [{ user_id: "owner" }], error: null });
    mocks.list.mockResolvedValue({ data: [], error: null });
    mocks.remove.mockResolvedValue({ error: null });
    mocks.deleteUser.mockResolvedValue({ error: null });
    mocks.update.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockResolvedValue({ error: null });
  });
  it("keeps auth and a retry record when storage removal fails", async () => {
    mocks.list.mockResolvedValueOnce({
      data: [{ id: "file", name: "image.png" }],
      error: null,
    });
    mocks.remove.mockResolvedValue({ error: { message: "unavailable" } });
    expect(await processAccountDeletions()).toEqual({
      processed: true,
      complete: false,
    });
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending" }),
    );
  });
  it("deletes auth only after all buckets verify empty", async () => {
    expect(await processAccountDeletions()).toEqual({
      processed: true,
      complete: true,
    });
    expect(mocks.list).toHaveBeenCalledTimes(4);
    expect(mocks.deleteUser).toHaveBeenCalledWith("owner");
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "complete" }),
    );
  });
  it("retries an auth deletion failure without reporting completion", async () => {
    mocks.deleteUser.mockResolvedValue({ error: { status: 503 } });
    expect((await processAccountDeletions()).complete).toBe(false);
  });
});
