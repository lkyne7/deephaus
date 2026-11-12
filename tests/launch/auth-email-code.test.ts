import { describe, expect, it, vi } from "vitest";
import {
  friendlyEmailCodeError,
  isCompleteEmailCode,
  newAccountMetadata,
  normalizeEmailCode,
} from "../../packages/shared/src/auth-email-code";
import { recordTermsAcceptance } from "../../packages/shared/src/auth-terms";

describe("email sign-in codes", () => {
  it("keeps digits from pasted codes and checks the length Supabase sends", () => {
    expect(normalizeEmailCode(" 123-456 ")).toBe("123456");
    expect(isCompleteEmailCode("12345")).toBe(false);
    expect(isCompleteEmailCode("123456")).toBe(true);
    expect(isCompleteEmailCode("12345678")).toBe(true);
    expect(isCompleteEmailCode("12345a")).toBe(false);
    expect(normalizeEmailCode("12345678901234")).toBe("1234567890");
  });

  it("undoes a code that autofill inserted twice", () => {
    expect(normalizeEmailCode("1234567812345678")).toBe("12345678");
    expect(normalizeEmailCode("123456 123456")).toBe("123456");
    expect(normalizeEmailCode("123456789012")).toBe("1234567890");
  });

  it("stores the terms time, and the name only when given", () => {
    const now = new Date("2026-11-12T00:00:00Z");
    expect(newAccountMetadata(undefined, now)).toEqual({ terms_accepted_at: "2026-11-12T00:00:00.000Z" });
    expect(newAccountMetadata("  Ada  ", now)).toEqual({
      terms_accepted_at: "2026-11-12T00:00:00.000Z",
      full_name: "Ada",
      name: "Ada",
    });
  });

  it("rewords Supabase's code errors and passes others through", () => {
    expect(friendlyEmailCodeError("Token has expired or is invalid")).toMatch(/wrong or has expired/);
    expect(friendlyEmailCodeError("For security purposes, you can only request this after 30 seconds.")).toMatch(/Wait a minute/);
    expect(friendlyEmailCodeError("email rate limit exceeded")).toMatch(/Too many sign-in emails/);
    expect(friendlyEmailCodeError("Request rate limit reached")).toMatch(/Too many attempts/);
    expect(friendlyEmailCodeError("captcha protection: request disallowed")).toBe("captcha protection: request disallowed");
  });

  it("records terms acceptance once and never blocks sign-in", async () => {
    const updateUser = vi.fn(async () => ({ error: null }));
    await recordTermsAcceptance({ auth: { updateUser } }, { user_metadata: { terms_accepted_at: "earlier" } });
    await recordTermsAcceptance({ auth: { updateUser } }, null);
    expect(updateUser).not.toHaveBeenCalled();
    await recordTermsAcceptance({ auth: { updateUser } }, { user_metadata: {} });
    expect(updateUser).toHaveBeenCalledWith({ data: { terms_accepted_at: expect.any(String) } });
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(recordTermsAcceptance({ auth: { updateUser: failing } }, { user_metadata: {} })).resolves.toBeUndefined();
  });
});
