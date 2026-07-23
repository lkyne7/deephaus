import type { OnboardingPreferences } from "@/lib/onboarding/types";

type UserWithMetadata = {
  created_at?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

// Onboarding shipped on July 4, 2026. Accounts created before then cannot have
// the completion flag unless they were later forced through the new flow.
const ONBOARDING_ROLLOUT_AT = Date.parse("2026-07-04T22:42:02Z");

export function isOnboardingCompleted(user: UserWithMetadata | null | undefined): boolean {
  if (!user) return false;

  const completionFlag = user.user_metadata?.onboarding_completed;
  if (typeof completionFlag === "boolean") return completionFlag;

  const createdAt = user.created_at ? Date.parse(user.created_at) : Number.NaN;
  return Number.isFinite(createdAt) && createdAt < ONBOARDING_ROLLOUT_AT;
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
