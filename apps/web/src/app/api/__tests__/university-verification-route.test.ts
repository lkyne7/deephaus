import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { requireUser, createServiceClient, loadUserProfile } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServiceClient: vi.fn(),
  loadUserProfile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("@/lib/user/profile", async () => {
  const actual = await vi.importActual<typeof import("@/lib/user/profile")>("@/lib/user/profile");
  return {
    ...actual,
    hashUniversityVerificationCode: vi.fn(() => "hashed-code"),
    loadUserProfile,
  };
});

import { POST } from "@/app/api/profile/university-email/verify/route";

function request(body: unknown) {
  return new Request("https://app.test/api/profile/university-email/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/profile/university-email/verify", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    createServiceClient.mockReturnValue({ rpc });
    loadUserProfile.mockResolvedValue({ username: "luke", university_name: "MIT" });
  });

  it("returns the verified profile after an atomic success", async () => {
    rpc.mockResolvedValue({ data: "verified", error: null });
    const response = await POST(request({ email: "student@mit.edu", code: "123456" }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("complete_university_email_verification", {
      target_user_id: "user-1",
      target_email: "student@mit.edu",
      submitted_code_hash: "hashed-code",
    });
    expect((await response.json()).profile.university_name).toBe("MIT");
  });

  it.each([
    ["invalid", 400],
    ["expired", 410],
    ["locked", 429],
    ["missing", 404],
  ])("maps %s challenges to status %i", async (status, expected) => {
    rpc.mockResolvedValue({ data: status, error: null });
    const response = await POST(request({ email: "student@mit.edu", code: "123456" }));
    expect(response.status).toBe(expected);
  });

  it("rejects malformed codes before querying", async () => {
    const response = await POST(request({ email: "student@mit.edu", code: "12" }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
