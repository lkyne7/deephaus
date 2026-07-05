export const ONBOARDING_REVIEW_GRADES = [
  { label: "Again", cls: "again", time: "< 1m", key: "1" },
  { label: "Hard", cls: "hard", time: "< 10m", key: "2" },
  { label: "Good", cls: "good", time: "< 1d", key: "3", alsoSpace: true },
  { label: "Easy", cls: "easy", time: "< 5d", key: "4" },
] as const;

export type OnboardingReviewGradeLabel = (typeof ONBOARDING_REVIEW_GRADES)[number]["label"];

export function onboardingGradeFromKey(key: string): OnboardingReviewGradeLabel | null {
  const hit = ONBOARDING_REVIEW_GRADES.find((g) => g.key === key);
  return hit?.label ?? null;
}

export function onboardingGradeShortcut(index: number): string {
  const g = ONBOARDING_REVIEW_GRADES[index];
  if (!g) return String(index + 1);
  return "alsoSpace" in g && g.alsoSpace ? `${g.key} · Space` : g.key;
}
