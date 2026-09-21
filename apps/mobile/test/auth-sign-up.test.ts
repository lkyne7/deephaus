import { beforeEach, expect, it, vi } from "vitest";
const signUp = vi.hoisted(() => vi.fn());
vi.mock("@/lib/config", () => ({ supabase: { auth: { signUp } } }));
vi.mock("expo-linking", () => ({ createURL: (path: string) => `deephaus-staging://${path}` }));
import { signUpWithEmail } from "../lib/auth-sign-up";

beforeEach(() => { signUp.mockReset(); });
it("returns confirmation emails to this app variant and reports that confirmation is required", async () => {
  signUp.mockResolvedValue({ data: { session: null }, error: null });
  expect(await signUpWithEmail("fixture@example.test", "password", " Learner ")).toEqual({ needsConfirmation: true });
  expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ options: {
    emailRedirectTo: "deephaus-staging://auth/callback",
    data: { full_name: "Learner", name: "Learner" },
  } }));
});
it("does not ask an already signed-in new user to sign in again", async () => {
  signUp.mockResolvedValue({ data: { session: { user: { id: "fixture" } } }, error: null });
  expect(await signUpWithEmail("fixture@example.test", "password", "Learner")).toEqual({ needsConfirmation: false });
});
it("returns provider errors and rejects invalid names before making a request", async () => {
  expect(await signUpWithEmail("fixture@example.test", "password", " ")).toEqual({ error: "Name is required." });
  expect(signUp).not.toHaveBeenCalled();
  signUp.mockResolvedValue({ data: { session: null }, error: { message: "Please try later" } });
  expect(await signUpWithEmail("fixture@example.test", "password", "Learner")).toEqual({ error: "Please try later" });
});
