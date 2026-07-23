import { describe, expect, it } from "vitest";
import { isOnboardingCompleted } from "@/lib/onboarding/metadata";

describe("isOnboardingCompleted", () => {
  it("accepts an explicit completion flag", () => {
    expect(
      isOnboardingCompleted({
        created_at: "2026-07-20T00:00:00Z",
        user_metadata: { onboarding_completed: true },
      }),
    ).toBe(true);
  });

  it("respects an explicit incomplete flag on legacy accounts", () => {
    expect(
      isOnboardingCompleted({
        created_at: "2026-05-24T00:00:00Z",
        user_metadata: { onboarding_completed: false },
      }),
    ).toBe(false);
  });

  it("grandfathers accounts created before onboarding launched", () => {
    expect(
      isOnboardingCompleted({
        created_at: "2026-05-24T00:00:00Z",
        user_metadata: {},
      }),
    ).toBe(true);
  });

  it("requires onboarding for newer accounts without a completion flag", () => {
    expect(
      isOnboardingCompleted({
        created_at: "2026-07-20T00:00:00Z",
        user_metadata: {},
      }),
    ).toBe(false);
  });

  it("fails closed when account creation time is missing or invalid", () => {
    expect(isOnboardingCompleted({ user_metadata: {} })).toBe(false);
    expect(isOnboardingCompleted({ created_at: "invalid", user_metadata: {} })).toBe(false);
    expect(isOnboardingCompleted(null)).toBe(false);
  });
});
