import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/perf/with-api-timing", () => ({
  withApiTiming: <T,>(handler: T) => handler,
}));

const { requireUser, createServiceClient } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

import { GET } from "@/app/api/stats/leaderboard/route";

function request(period?: string) {
  const query = period ? `?period=${period}` : "";
  return new Request(`https://app.test/api/stats/leaderboard${query}`);
}

const RPC_ROWS = [
  {
    user_id: "user-2",
    username: "ada",
    review_count: 120,
    rank: 1,
  },
  {
    user_id: "user-1",
    username: "luke_kyne",
    review_count: 80,
    rank: 2,
  },
];

describe("GET /api/stats/leaderboard", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    createServiceClient.mockReturnValue({ rpc });
    rpc.mockResolvedValue({ data: RPC_ROWS, error: null });
  });

  it("rejects invalid periods", async () => {
    const response = await GET(request("decade"));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns ranked entries with public usernames", async () => {
    const response = await GET(request("week"));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.period).toBe("week");
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({
      rank: 1,
      username: "ada",
      reviews: 120,
      isMe: false,
    });
    expect(body.entries[1]).toMatchObject({
      rank: 2,
      username: "luke_kyne",
      reviews: 80,
      isMe: true,
    });
    expect(body.me).toEqual({ rank: 2, reviews: 80 });
    expect(JSON.stringify(body)).not.toContain("email");

    expect(rpc).toHaveBeenCalledWith("get_review_leaderboard", {
      period_start: expect.any(String),
      max_rows: expect.any(Number),
      include_user_id: "user-1",
    });
  });

  it("passes a null period start for all-time rankings", async () => {
    await GET(request("all"));
    expect(rpc).toHaveBeenCalledWith(
      "get_review_leaderboard",
      expect.objectContaining({ period_start: null }),
    );
  });

  it("returns a null me entry when the user has no reviews", async () => {
    rpc.mockResolvedValue({ data: [RPC_ROWS[0]], error: null });
    const response = await GET(request("week"));
    const body = await response.json();
    expect(body.me).toBeNull();
  });

  it("surfaces query failures as 500s", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const response = await GET(request("week"));
    expect(response.status).toBe(500);
  });
});
