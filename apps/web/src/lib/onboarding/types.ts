export type OnboardingGoal =
  | "exam"
  | "lang"
  | "school"
  | "cert"
  | "hobby"
  | "curious";

export type OnboardingStepId =
  | "welcome"
  | "goal"
  | "daily"
  | "how"
  | "source"
  | "generating"
  | "firstcard"
  | "done";

export type OnboardingPreferences = {
  goal: OnboardingGoal;
  daily: number;
};

export type OnboardingDeckResult = {
  projectId: string;
  deckName: string;
  cardCount: number;
  firstCard: {
    id: string;
    type: "basic" | "cloze";
    front: string | null;
    back: string | null;
    clozeText: string | null;
  };
};

export const ONBOARDING_STEPS: OnboardingStepId[] = [
  "welcome",
  "goal",
  "daily",
  "how",
  "source",
  "generating",
  "firstcard",
  "done",
];

/** Steps that show progress in the top bar. */
export const ONBOARDING_TRACKED_STEPS: OnboardingStepId[] = [
  "goal",
  "daily",
  "how",
  "source",
  "firstcard",
];

/** Steps the user can skip forward from. */
export const ONBOARDING_OPTIONAL_STEPS = new Set<OnboardingStepId>([
  "goal",
  "daily",
  "how",
  "source",
]);

export const DEFAULT_ONBOARDING_PREFERENCES: OnboardingPreferences = {
  goal: "exam",
  daily: 20,
};

export const SAMPLE_SOURCE_TEXT =
  "The heart's electrical system starts at the sinoatrial (SA) node, the body's natural pacemaker. It fires impulses that travel through the atria, making them contract and push blood into the ventricles. The atrioventricular (AV) node briefly delays the signal before it reaches the bundle of His and Purkinje fibers, coordinating ventricular contraction.";

export const GOAL_OPTIONS: Array<{
  id: OnboardingGoal;
  icon: string;
  label: string;
  hint: string;
}> = [
  { id: "exam", icon: "ri-graduation-cap-line", label: "Exam prep", hint: "MCAT, bar, finals" },
  { id: "lang", icon: "ri-translate-2", label: "Learn a language", hint: "Vocab, grammar, kanji" },
  { id: "school", icon: "ri-book-open-line", label: "Keep up at school", hint: "Lectures & slides" },
  { id: "cert", icon: "ri-award-line", label: "Work certification", hint: "AWS, PMP, CFA" },
  { id: "hobby", icon: "ri-compass-3-line", label: "A hobby", hint: "Chess, birds, wine" },
  { id: "curious", icon: "ri-sparkling-2-line", label: "Just curious", hint: "Show me around" },
];

export const DAILY_PRESETS = [10, 20, 30, 50] as const;
