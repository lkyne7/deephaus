import { describe, it, expect } from "vitest";
import { parseAuthCallback } from "../lib/auth-callback";
describe("native callback validation", () => {
  it("recognizes cold-start PKCE recovery links", () =>
    expect(
      parseAuthCallback("deephaus://auth/callback?code=code&recovery=1"),
    ).toMatchObject({ code: "code", recovery: true }));
  it("recognizes already-open Expo callbacks and implicit recovery fragments", () =>
    expect(
      parseAuthCallback(
        "exp://127.0.0.1:8081/--/auth/callback#type=recovery&access_token=access&refresh_token=refresh",
      ),
    ).toMatchObject({
      recovery: true,
      accessToken: "access",
      refreshToken: "refresh",
    }));
  it.each([
    "https://evil.test/auth/callback?code=x",
    "deephaus://wrong/--/auth/callback?code=x",
    "deephaus://dashboard",
  ])("ignores unrelated callbacks %s", (url) =>
    expect(parseAuthCallback(url)).toBeNull(),
  );
  it("surfaces invalid links without exposing provider details", () =>
    expect(() =>
      parseAuthCallback("deephaus://auth/callback?error_description=secret"),
    ).toThrow("invalid or expired"));
});


describe("staging callback isolation", () => {
  it("accepts the configured staging scheme but rejects another variant", () => {
    expect(parseAuthCallback("deephaus-staging://auth/callback?code=x&recovery=1", "deephaus-staging")).toMatchObject({ code: "x", recovery: true });
    expect(parseAuthCallback("deephaus://auth/callback?code=x", "deephaus-staging")).toBeNull();
    expect(parseAuthCallback("deephaus-staging://auth/callback?code=x")).toBeNull();
  });
});
