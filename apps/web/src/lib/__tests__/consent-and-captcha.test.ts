import { describe, expect, it } from "vitest";
import { friendlyAuthError } from "@/lib/captcha-errors";
import { captchaReturnUrl } from "@/lib/captcha-return";
import { countryNeedsConsent } from "@/lib/consent";

describe("analytics consent region", () => {
  it("asks visitors from the EU, EEA, UK and Switzerland", () => {
    for (const country of ["DE", "fr", "IE", "NO", "GB", "CH"]) expect(countryNeedsConsent(country)).toBe(true);
  });
  it("leaves everyone else, and unknown locations, as they are", () => {
    for (const country of ["US", "CA", "AU", "", null, undefined]) expect(countryNeedsConsent(country)).toBe(false);
  });
});

describe("captcha hand-off to the phone", () => {
  it("returns tokens only to the phone app's schemes", () => {
    expect(captchaReturnUrl("deephaus://captcha", "a b")).toBe("deephaus://captcha?token=a%20b");
    expect(captchaReturnUrl("deephaus-staging:///captcha", "t")).toBe("deephaus-staging:///captcha?token=t");
    for (const target of ["https://evil.example/captcha", "deephaus://auth/callback", "javascript:alert(1)//captcha", "evil://captcha"])
      expect(captchaReturnUrl(target, "t")).toBeNull();
  });
});

describe("captcha rejections from Supabase", () => {
  it("replaces the raw CAPTCHA message and leaves other errors alone", () => {
    expect(friendlyAuthError("captcha protection: request disallowed (captcha verification process failed)")).toMatch(/security check didn't pass/);
    expect(friendlyAuthError("Invalid login credentials")).toBe("Invalid login credentials");
  });
});
