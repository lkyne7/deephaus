import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createServerClient, exchangeCodeForSession } = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient }));

import { GET } from "@/app/auth/callback/route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServerClient.mockReturnValue({
      auth: {
        exchangeCodeForSession,
        verifyOtp: vi.fn(),
      },
    });
    exchangeCodeForSession.mockResolvedValue({ error: null });
  });

  it("exchanges OAuth codes and preserves safe relative destinations", async () => {
    const response = await GET(
      new NextRequest("https://app.test/auth/callback?code=abc&next=/dashboard"),
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.headers.get("location")).toBe("https://app.test/dashboard");
  });

  it("rejects protocol-relative redirect attempts", async () => {
    const response = await GET(
      new NextRequest("https://app.test/auth/callback?code=abc&next=//evil.test"),
    );
    expect(response.headers.get("location")).toBe("https://app.test/dashboard");
  });
});
