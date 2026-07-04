import type { OnboardingPreferences } from "@/lib/onboarding/types";

type UserWithMetadata = {
  user_metadata?: Record<string, unknown> | null;
};

export function isOnboardingCompleted(user: UserWithMetadata | null | undefined): boolean {
  return user?.user_metadata?.onboarding_completed === true;
}

export function getOnboardingPreferences(
  user: UserWithMetadata | null | undefined,
): OnboardingPreferences | null {
  const raw = user?.user_metadata?.onboarding;
  if (!raw || typeof raw !== "object") return null;
  const prefs = raw as Record<string, unknown>;
  if (typeof prefs.goal !== "string" || typeof prefs.daily !== "number") return null;
  return { goal: prefs.goal as OnboardingPreferences["goal"], daily: prefs.daily };
}
