import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireUser, exchangeGoogleDriveCode, saveGoogleDriveConnection } = vi.hoisted(() => ({
  requireUser: vi.fn(),
  exchangeGoogleDriveCode: vi.fn(),
  saveGoogleDriveConnection: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser }));
vi.mock("@/lib/notion/request-origin", () => ({
  requestOrigin: () => "https://app.test",
}));
vi.mock("@/lib/google-drive/client", () => ({
  GOOGLE_DRIVE_STATE_COOKIE: "google_drive_oauth_state",
  exchangeGoogleDriveCode,
  googleDriveRedirectUri: () => "https://app.test/api/google-drive/callback",
  saveGoogleDriveConnection,
}));

import { GET } from "@/app/api/google-drive/callback/route";

function callbackRequest(state: string, cookieState: string) {
  const request = new NextRequest(
    `https://app.test/api/google-drive/callback?code=auth-code&state=${state}`,
  );
  request.cookies.set(
    "google_drive_oauth_state",
    JSON.stringify({ state: cookieState, returnTo: "/create?deck=deck-1" }),
  );
  return request;
}

describe("Google Drive OAuth callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ user: { id: "user-1" }, response: null });
    exchangeGoogleDriveCode.mockResolvedValue({
      access_token: "access",
      refresh_token: "refresh",
      expires_in: 3600,
      token_type: "Bearer",
    });
  });

  it("rejects a mismatched OAuth state before exchanging tokens", async () => {
    const response = await GET(callbackRequest("wrong", "expected"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("googleDrive=error");
    expect(exchangeGoogleDriveCode).not.toHaveBeenCalled();
  });

  it("stores tokens and preserves the return query string", async () => {
    const response = await GET(callbackRequest("expected", "expected"));
    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("deck")).toBe("deck-1");
    expect(location.searchParams.get("googleDrive")).toBe("connected");
    expect(saveGoogleDriveConnection).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ access_token: "access" }),
    );
  });
});
