import { beforeEach, expect, it, vi } from "vitest";
const signUp = vi.hoisted(() => vi.fn());
vi.mock("@/lib/config", () => ({ supabase: { auth: { signUp } } }));
const getCaptchaToken = vi.hoisted(() => vi.fn(async () => undefined as string | undefined));
vi.mock("@/lib/captcha", () => ({ getCaptchaToken }));
vi.mock("expo-linking", () => ({ createURL: (path: string) => `deephaus-staging://${path}` }));
import { signUpWithEmail } from "../lib/auth-sign-up";

beforeEach(() => { signUp.mockReset(); });
it("returns confirmation emails to this app variant and reports that confirmation is required", async () => {
  signUp.mockResolvedValue({ data: { session: null }, error: null });
  expect(await signUpWithEmail("fixture@example.test", "password", " Learner ", true)).toEqual({ needsConfirmation: true });
  expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ options: {
    emailRedirectTo: "deephaus-staging://auth/callback",
    data: { full_name: "Learner", name: "Learner", terms_accepted_at: expect.any(String) },
  } }));
});
it("does not ask an already signed-in new user to sign in again", async () => {
  signUp.mockResolvedValue({ data: { session: { user: { id: "fixture" } } }, error: null });
  expect(await signUpWithEmail("fixture@example.test", "password", "Learner", true)).toEqual({ needsConfirmation: false });
});
it("returns provider errors and rejects invalid names before making a request", async () => {
  expect(await signUpWithEmail("fixture@example.test", "password", " ", true)).toEqual({ error: "Name is required." });
  expect(signUp).not.toHaveBeenCalled();
  signUp.mockResolvedValue({ data: { session: null }, error: { message: "Please try later" } });
  expect(await signUpWithEmail("fixture@example.test", "password", "Learner", true)).toEqual({ error: "Please try later" });
});

it("rejects a new password under the minimum before making a request", async () => {
  expect(await signUpWithEmail("fixture@example.test", "short12", "Learner", true)).toEqual({
    error: "Use at least 8 characters.",
  });
});

it("refuses to create an account without the age and terms confirmation", async () => {
  expect(await signUpWithEmail("fixture@example.test", "password", "Learner", false)).toEqual({
    error: "Confirm you're 13 or older and accept the Terms to create an account.",
  });
  expect(signUp).not.toHaveBeenCalled();
});

it("sends the Turnstile token when CAPTCHA protection is on, and stops if the check is canceled", async () => {
  signUp.mockResolvedValue({ data: { session: null }, error: null });
  getCaptchaToken.mockResolvedValueOnce("turnstile-token");
  await signUpWithEmail("fixture@example.test", "password", "Learner", true);
  expect(signUp.mock.calls[0]![0].options.captchaToken).toBe("turnstile-token");
  getCaptchaToken.mockRejectedValueOnce(new Error("The security check was canceled."));
  expect(await signUpWithEmail("fixture@example.test", "password", "Learner", true)).toEqual({
    error: "The security check was canceled.",
  });
  expect(signUp).toHaveBeenCalledTimes(1);
});
