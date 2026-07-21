import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { requireUser, createServiceClient, resolveUniversityEmail, resendSend } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServiceClient: vi.fn(),
  resolveUniversityEmail: vi.fn(),
  resendSend: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));
vi.mock("@/lib/user/profile", async () => {
  const actual = await vi.importActual<typeof import("@/lib/user/profile")>("@/lib/user/profile");
  return {
    ...actual,
    createUniversityVerificationCode: vi.fn(() => "123456"),
    hashUniversityVerificationCode: vi.fn(() => "hashed-code"),
    resolveUniversityEmail,
  };
});

import { POST } from "@/app/api/profile/university-email/send/route";

function request(email = "student@mit.edu") {
  return new Request("https://app.test/api/profile/university-email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

function chain(result: unknown) {
  const value: Record<string, unknown> = {};
  for (const method of ["select", "eq", "upsert", "delete"]) {
    value[method] = vi.fn(() => value);
  }
  value.maybeSingle = vi.fn(async () => result);
  return value;
}

describe("POST /api/profile/university-email/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESEND_API_KEY = "re_test";
    process.env.UNIVERSITY_VERIFICATION_FROM_EMAIL = "verify@example.com";
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    resolveUniversityEmail.mockResolvedValue({
      email: "student@mit.edu",
      universityName: "Massachusetts Institute of Technology",
      universityDomain: "mit.edu",
    });
    resendSend.mockResolvedValue({ data: { id: "email-1" }, error: null });
  });

  it("rate-limits repeated code requests", async () => {
    const lookup = chain({ data: { sent_at: new Date().toISOString() }, error: null });
    createServiceClient.mockReturnValue({ from: vi.fn(() => lookup) });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("stores a hashed challenge and sends the code", async () => {
    const lookup = chain({ data: null, error: null });
    const save = chain({ data: null, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(save);
    createServiceClient.mockReturnValue({ from });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(save.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        email: "student@mit.edu",
        code_hash: "hashed-code",
        attempts: 0,
      }),
    );
    expect(resendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "student@mit.edu",
        text: expect.stringContaining("123456"),
      }),
    );
  });
});
