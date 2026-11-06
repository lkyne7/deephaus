import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { capture, createServerClient, exchangeCodeForSession, flush, verifyOtp } = vi.hoisted(() => ({
  capture: vi.fn(),
  createServerClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  flush: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("posthog-node", () => ({
  PostHog: class {
    capture = capture;
    flush = flush;
  },
}));

import { GET } from "@/app/auth/callback/route";

const newGoogleUser = {
  id: "user-1",
  created_at: "2026-11-04T10:00:00Z",
  email_confirmed_at: "2026-11-04T10:00:00Z",
  last_sign_in_at: "2026-11-04T10:00:02Z",
  app_metadata: { provider: "google" },
};

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_RELEASE_ID", "abc123");
    createServerClient.mockReturnValue({
      auth: { exchangeCodeForSession, verifyOtp },
    });
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: null });
    flush.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exchanges OAuth codes and preserves safe relative destinations", async () => {
    const response = await GET(
      new NextRequest("https://app.test/auth/callback?code=abc&next=/dashboard"),
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.headers.get("location")).toBe("https://app.test/dashboard");
  });

  it("sends recovery links to the new password page with a recovery marker", async () => {
    const response = await GET(
      new NextRequest("https://app.test/auth/callback?code=abc&recovery=1&next=/reset-password"),
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.headers.get("location")).toBe("https://app.test/reset-password");
    const marker = response.cookies.get("dh_password_recovery");
    expect(marker?.value).toBe("1");
    expect(marker?.httpOnly).toBe(true);
  });

  it("treats recovery token links the same way", async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: null });
    const response = await GET(
      new NextRequest("https://app.test/auth/callback?token_hash=abc&type=recovery&next=/dashboard"),
    );
    expect(response.headers.get("location")).toBe("https://app.test/reset-password");
    expect(response.cookies.get("dh_password_recovery")?.value).toBe("1");
  });

  it("recognises recovery from next alone, as the desktop hand-off drops other params", async () => {
    const response = await GET(
      new NextRequest("https://app.test/auth/callback?code=abc&next=%2Freset-password"),
    );
    expect(response.cookies.get("dh_password_recovery")?.value).toBe("1");
  });

  it("explains failed recovery links on the reset page", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    const response = await GET(new NextRequest("https://app.test/auth/callback?code=abc&recovery=1"));
    expect(response.headers.get("location")).toBe("https://app.test/reset-password?error=link");
    expect(response.cookies.get("dh_password_recovery")).toBeUndefined();

    const noCode = await GET(new NextRequest("https://app.test/auth/callback?recovery=1&error=access_denied"));
    expect(noCode.headers.get("location")).toBe("https://app.test/reset-password?error=link");
  });

  it("does not mark ordinary sign-ins as recovery", async () => {
    const response = await GET(new NextRequest("https://app.test/auth/callback?code=abc"));
    expect(response.cookies.get("dh_password_recovery")).toBeUndefined();
  });

  it("rejects protocol-relative redirect attempts", async () => {
    const response = await GET(
      new NextRequest("https://app.test/auth/callback?code=abc&next=//evil.test"),
    );
    expect(response.headers.get("location")).toBe("https://app.test/dashboard");
  });

  it("records a signup for a new OAuth account", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: newGoogleUser }, error: null });
    await GET(new NextRequest("https://app.test/auth/callback?code=abc"));
    expect(capture).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "user_signed_up",
      properties: { method: "google", release: "abc123" },
    });
    expect(flush).toHaveBeenCalled();
  });

  it("records a signup when an email is confirmed long after the account was created", async () => {
    verifyOtp.mockResolvedValue({
      data: {
        user: {
          id: "user-2",
          created_at: "2026-11-01T10:00:00Z",
          email_confirmed_at: "2026-11-04T10:00:00Z",
          last_sign_in_at: "2026-11-04T10:00:01Z",
          app_metadata: { provider: "email" },
        },
      },
      error: null,
    });
    await GET(new NextRequest("https://app.test/auth/callback?token_hash=abc&type=signup"));
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user-2",
        properties: expect.objectContaining({ method: "password" }),
      }),
    );
  });

  it("records a signup when the first sign-in time is not on the user yet", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { ...newGoogleUser, last_sign_in_at: undefined } },
      error: null,
    });
    await GET(new NextRequest("https://app.test/auth/callback?code=abc"));
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("does not record a signup for a returning user", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: { ...newGoogleUser, last_sign_in_at: "2026-11-05T10:00:00Z" } },
      error: null,
    });
    await GET(new NextRequest("https://app.test/auth/callback?code=abc"));
    expect(capture).not.toHaveBeenCalled();
  });

  it("does not record a signup when the code exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: "expired" },
    });
    const response = await GET(new NextRequest("https://app.test/auth/callback?code=abc"));
    expect(capture).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toContain("/?error=auth");
  });

  it("still signs the user in when analytics delivery fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: newGoogleUser }, error: null });
    flush.mockRejectedValue(new Error("network"));
    const response = await GET(
      new NextRequest("https://app.test/auth/callback?code=abc&next=/onboarding"),
    );
    expect(response.headers.get("location")).toBe("https://app.test/onboarding");
  });
});
