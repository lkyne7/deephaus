import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.hoisted(() => vi.fn());
const verifyOtp = vi.hoisted(() => vi.fn());
const updateUser = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithOtp, verifyOtp, updateUser } }),
}));
const captureFirstSignIn = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/posthog-server", () => ({ captureFirstSignIn }));

import { sendEmailCodeAction, verifyEmailCodeAction } from "@/lib/auth-actions";

beforeEach(() => {
  signInWithOtp.mockReset();
  verifyOtp.mockReset();
  updateUser.mockClear();
});

describe("email code sign-in actions", () => {
  it("sends a code that can create the account, with the link back to this site", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    expect(await sendEmailCodeAction(" a@example.test ", "https://app.example", "/decks", "tok")).toEqual({ ok: true });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "a@example.test",
      options: {
        shouldCreateUser: true,
        emailRedirectTo: "https://app.example/auth/callback?next=%2Fdecks",
        data: { terms_accepted_at: expect.any(String) },
        captchaToken: "tok",
      },
    });
  });

  it("refuses an empty email without calling Supabase", async () => {
    expect(await sendEmailCodeAction("  ", "https://app.example")).toEqual({ error: "Enter your email." });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("verifies the code as an email OTP and records first sign-ins", async () => {
    const user = { id: "u1", user_metadata: { terms_accepted_at: "earlier" } };
    verifyOtp.mockResolvedValue({ data: { user }, error: null });
    expect(await verifyEmailCodeAction("a@example.test", "123 456")).toEqual({ ok: true });
    expect(verifyOtp).toHaveBeenCalledWith({ email: "a@example.test", token: "123456", type: "email" });
    expect(captureFirstSignIn).toHaveBeenCalledWith(user);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("explains a wrong or expired code", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "Token has expired or is invalid" } });
    expect(await verifyEmailCodeAction("a@example.test", "123456")).toEqual({
      error: "That code is wrong or has expired. Check the latest email, or send a new code.",
    });
  });
});
