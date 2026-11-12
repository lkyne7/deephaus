import { beforeEach, expect, it, vi } from "vitest";
const signInWithOtp = vi.hoisted(() => vi.fn());
const verifyOtp = vi.hoisted(() => vi.fn());
const updateUser = vi.hoisted(() => vi.fn(async () => ({ error: null })));
vi.mock("@/lib/config", () => ({ supabase: { auth: { signInWithOtp, verifyOtp, updateUser } } }));
const getCaptchaToken = vi.hoisted(() => vi.fn(async () => undefined as string | undefined));
vi.mock("@/lib/captcha", () => ({ getCaptchaToken }));
vi.mock("expo-linking", () => ({ createURL: (path: string) => `deephaus-staging://${path}` }));
import { sendEmailCode, verifyEmailCode } from "../lib/auth-email-code";

beforeEach(() => {
  signInWithOtp.mockReset();
  verifyOtp.mockReset();
  updateUser.mockClear();
  getCaptchaToken.mockReset();
  getCaptchaToken.mockResolvedValue(undefined);
});

it("sends a code that can create the account and records the terms on new accounts", async () => {
  signInWithOtp.mockResolvedValue({ error: null });
  expect(await sendEmailCode(" fixture@example.test ")).toBeNull();
  expect(signInWithOtp).toHaveBeenCalledWith({
    email: "fixture@example.test",
    options: {
      shouldCreateUser: true,
      emailRedirectTo: "deephaus-staging://auth/callback",
      data: { terms_accepted_at: expect.any(String) },
    },
  });
});

it("passes the Turnstile token, and stops when the check is canceled", async () => {
  signInWithOtp.mockResolvedValue({ error: null });
  getCaptchaToken.mockResolvedValueOnce("turnstile-token");
  await sendEmailCode("fixture@example.test");
  expect(signInWithOtp.mock.calls[0]![0].options.captchaToken).toBe("turnstile-token");
  getCaptchaToken.mockRejectedValueOnce(new Error("The security check was canceled."));
  expect(await sendEmailCode("fixture@example.test")).toBe("The security check was canceled.");
  expect(signInWithOtp).toHaveBeenCalledTimes(1);
});

it("explains the one-minute resend limit", async () => {
  signInWithOtp.mockResolvedValue({ error: { message: "For security purposes, you can only request this after 42 seconds." } });
  expect(await sendEmailCode("fixture@example.test")).toBe("A code was just sent. Wait a minute before asking for another.");
});

it("verifies pasted codes and fills in the terms time for accounts without one", async () => {
  verifyOtp.mockResolvedValue({ data: { user: { id: "u1", user_metadata: {} } }, error: null });
  expect(await verifyEmailCode("fixture@example.test", "123 456")).toEqual({ user: { id: "u1", user_metadata: {} } });
  expect(verifyOtp).toHaveBeenCalledWith({ email: "fixture@example.test", token: "123456", type: "email" });
  expect(updateUser).toHaveBeenCalledWith({ data: { terms_accepted_at: expect.any(String) } });
});

it("rejects short codes without a request and words expired codes plainly", async () => {
  expect(await verifyEmailCode("fixture@example.test", "12")).toEqual({ error: "Enter the code from the email." });
  expect(verifyOtp).not.toHaveBeenCalled();
  verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "Token has expired or is invalid" } });
  expect(await verifyEmailCode("fixture@example.test", "123456")).toEqual({
    error: "That code is wrong or has expired. Check the latest email, or send a new code.",
  });
});
