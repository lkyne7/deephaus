import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { requireUser, createServiceClient, getUniversityById, loadUserProfile } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServiceClient: vi.fn(),
  getUniversityById: vi.fn(),
  loadUserProfile: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("@/lib/user/universities", () => ({ getUniversityById }));
vi.mock("@/lib/user/profile", async () => {
  const actual = await vi.importActual<typeof import("@/lib/user/profile")>("@/lib/user/profile");
  return { ...actual, loadUserProfile };
});

import { GET, PATCH } from "@/app/api/profile/route";

const PROFILE = {
  user_id: "user-1",
  username: "luke",
  full_name: "Luke Kyne",
  university_name: null,
  university_domain: null,
  university_email: null,
  university_email_verified_at: null,
};

function patchRequest(body: unknown) {
  return new Request("https://app.test/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/profile", () => {
  const updateUser = vi.fn();
  const single = vi.fn();
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    updateUser.mockResolvedValue({ error: null });
    requireUser.mockResolvedValue({
      user: { id: "user-1" },
      supabase: { auth: { updateUser } },
      response: null,
    });
    loadUserProfile.mockResolvedValue(PROFILE);
    getUniversityById.mockReturnValue({
      id: "CA:McMaster University:mcmaster.ca",
      name: "McMaster University",
      country: "Canada",
      country_code: "CA",
      domains: ["mcmaster.ca"],
    });
    single.mockResolvedValue({ data: PROFILE, error: null });
    chain.update = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.select = vi.fn(() => chain);
    chain.single = single;
    createServiceClient.mockReturnValue({ from: vi.fn(() => chain) });
  });

  it("returns only the signed-in user's profile", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(PROFILE);
    expect(loadUserProfile).toHaveBeenCalledWith("user-1");
  });

  it("normalizes and updates usernames and full names", async () => {
    const response = await PATCH(
      patchRequest({ username: " Luke_Kyne ", full_name: " Luke Kyne " }),
    );
    expect(response.status).toBe(200);
    expect(chain.update).toHaveBeenCalledWith({
      username: "luke_kyne",
      full_name: "Luke Kyne",
    });
    expect(updateUser).toHaveBeenCalledWith({
      data: { full_name: "Luke Kyne", name: "Luke Kyne" },
    });
  });

  it("reports username collisions without changing auth metadata", async () => {
    single.mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate" } });
    const response = await PATCH(patchRequest({ username: "taken_name" }));
    expect(response.status).toBe(409);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("stores an unverified canonical university selection", async () => {
    const response = await PATCH(
      patchRequest({ university_id: "CA:McMaster University:mcmaster.ca" }),
    );
    expect(response.status).toBe(200);
    expect(chain.update).toHaveBeenCalledWith({
      university_name: "McMaster University",
      university_domain: "mcmaster.ca",
      university_email: null,
      university_email_verified_at: null,
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects reserved usernames", async () => {
    const response = await PATCH(patchRequest({ username: "admin" }));
    expect(response.status).toBe(400);
    expect(chain.update).not.toHaveBeenCalled();
  });
});
