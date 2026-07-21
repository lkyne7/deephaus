import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createServiceClient } = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient }));
vi.mock("@/lib/notion/client", () => ({
  canonicalAppOrigin: (value: string) => value.replace(/\/$/, ""),
}));

import {
  GOOGLE_DRIVE_SCOPE,
  getGoogleDriveAccessToken,
  googleDriveAuthorizeUrl,
} from "@/lib/google-drive/client";

const originalFetch = global.fetch;

function serviceClient(connection: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => ({ data: connection, error: null }));
  chain.upsert = vi.fn(async () => ({ data: null, error: null }));
  chain.delete = vi.fn(() => chain);
  chain.then = (resolve: (value: unknown) => void) => resolve({ data: null, error: null });
  return { from: vi.fn(() => chain), chain };
}

describe("Google Drive OAuth client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("requests offline least-privilege drive.file access", () => {
    const url = new URL(googleDriveAuthorizeUrl("state-1", "https://app.test/callback"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_DRIVE_SCOPE);
    expect(url.searchParams.get("scope")).toContain("drive.file");
    expect(url.searchParams.get("scope")).not.toContain("drive.readonly");
  });

  it("returns an unexpired stored access token without a network request", async () => {
    const mock = serviceClient({
      user_id: "user-1",
      access_token: "current-token",
      refresh_token: "refresh-token",
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      account_email: "user@example.com",
      account_name: "User",
    });
    createServiceClient.mockReturnValue(mock);
    global.fetch = vi.fn();

    await expect(getGoogleDriveAccessToken("user-1")).resolves.toBe("current-token");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refreshes an expired token and persists the replacement", async () => {
    const mock = serviceClient({
      user_id: "user-1",
      access_token: "expired-token",
      refresh_token: "refresh-token",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      account_email: "user@example.com",
      account_name: "User",
    });
    createServiceClient.mockReturnValue(mock);
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ email: "user@example.com", name: "User" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(getGoogleDriveAccessToken("user-1")).resolves.toBe("new-token");
    expect(mock.chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        access_token: "new-token",
        refresh_token: "refresh-token",
      }),
      { onConflict: "user_id" },
    );
  });
});
