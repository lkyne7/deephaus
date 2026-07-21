import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { requireUser, createServiceClient } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServiceClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));

import { DELETE, POST } from "@/app/api/profile/avatar/route";

function uploadRequest(file: File | null) {
  const form = new FormData();
  if (file) form.append("file", file);
  return new Request("https://app.test/api/profile/avatar", {
    method: "POST",
    body: form,
  });
}

describe("/api/profile/avatar", () => {
  const storageUpload = vi.fn();
  const storageList = vi.fn();
  const storageRemove = vi.fn();
  const getPublicUrl = vi.fn();
  const profileUpdateEq = vi.fn();
  const profileUpdate = vi.fn(() => ({ eq: profileUpdateEq }));

  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    storageUpload.mockResolvedValue({ error: null });
    storageList.mockResolvedValue({ data: [], error: null });
    storageRemove.mockResolvedValue({ data: null, error: null });
    getPublicUrl.mockReturnValue({
      data: { publicUrl: "https://cdn.test/avatars/user-1/avatar-1.png" },
    });
    profileUpdateEq.mockResolvedValue({ error: null });
    createServiceClient.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          upload: storageUpload,
          list: storageList,
          remove: storageRemove,
          getPublicUrl,
        })),
      },
      from: vi.fn(() => ({ update: profileUpdate })),
    });
  });

  it("uploads a picture and saves the public URL", async () => {
    const file = new File(["fake-png"], "me.png", { type: "image/png" });
    const response = await POST(uploadRequest(file));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      avatar_url: "https://cdn.test/avatars/user-1/avatar-1.png",
    });
    expect(storageUpload).toHaveBeenCalledWith(
      expect.stringMatching(/^user-1\/avatar-\d+\.png$/),
      expect.anything(),
      expect.objectContaining({ contentType: "image/png" }),
    );
    expect(profileUpdate).toHaveBeenCalledWith({
      avatar_url: "https://cdn.test/avatars/user-1/avatar-1.png",
    });
    expect(profileUpdateEq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("replaces any previously stored avatar files", async () => {
    storageList.mockResolvedValue({
      data: [{ id: "old", name: "avatar-0.jpg" }],
      error: null,
    });
    const file = new File(["fake"], "me.jpg", { type: "image/jpeg" });
    const response = await POST(uploadRequest(file));
    expect(response.status).toBe(201);
    expect(storageRemove).toHaveBeenCalledWith(["user-1/avatar-0.jpg"]);
  });

  it("rejects non-image uploads", async () => {
    const file = new File(["plain"], "notes.txt", { type: "text/plain" });
    const response = await POST(uploadRequest(file));
    expect(response.status).toBe(400);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("rejects missing files", async () => {
    const response = await POST(uploadRequest(null));
    expect(response.status).toBe(400);
  });

  it("removes the avatar and clears the profile URL", async () => {
    storageList.mockResolvedValue({
      data: [{ id: "old", name: "avatar-0.jpg" }],
      error: null,
    });
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ avatar_url: null });
    expect(storageRemove).toHaveBeenCalledWith(["user-1/avatar-0.jpg"]);
    expect(profileUpdate).toHaveBeenCalledWith({ avatar_url: null });
  });
});
